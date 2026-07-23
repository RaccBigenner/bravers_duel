import {
  cardById,
  effectiveAttributes,
  isCharAlive,
  maxHpOf,
  predictSkill,
  skillEffectOf,
  type BattleAction,
  type BattleState,
  type CharacterCard,
} from '@bravers/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BattleSetup } from '../App';
import { CardFrame } from '../CardFrame';
import { IMG } from '../cardAssets';
import type { NarrEvent } from '../battle/narrator';
import { ALL_SFX, isSfxEnabled, playSfx, preloadSfx, setSfxEnabled } from '../battle/sfx';
import { useBattle, type DamagePop } from '../battle/useBattle';
import { RulesModal } from './RulesModal';
import '../battle.css';

const PLAYER = 0 as const;
const ENEMY = 1 as const;

/** 対象選択モード。合法手から導出した「選べる対象 → 実行する行動」の表を持つ */
type Targeting = {
  side: 0 | 1; // 対象側
  hint: string;
  actions: Map<number, BattleAction>; // charIndex → action
} | null;

/** 画面の高さ（リサイズ追従） */
function useViewportHeight(): number {
  const [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => {
    // リサイズは間引く（頻繁なレイアウト変更で画面がガタつくのを防ぐ）
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setVh(window.innerHeight), 180);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return vh;
}

/**
 * キャラカードの基準サイズ。
 * 陣形を横長の楕円にしたぶん縦に余裕ができたので、高さ上限を引き上げ、
 * 横は「陣形の全幅が画面に収まる」ことを上限にする。
 */
function cardWidthFor(vh: number, vw: number): number {
  const byHeight = vh >= 840 ? 118 : vh >= 760 ? 110 : vh >= 700 ? 100 : 88;
  const byWidth = Math.floor((Math.min(vw, 440) - 70) / 2.95);
  return Math.min(byHeight, byWidth);
}

/** 飛んでいくカードの演出 */
interface Flight {
  key: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  faceCardId?: string;
}

let flightKey = 1;

/** 長押し（500ms）でコールバック。発火したら直後のclickは無視される */
function longPressHandlers(onLong: () => void) {
  let timer: number | null = null;
  let fired = false;
  const start = () => {
    fired = false;
    timer = window.setTimeout(() => {
      fired = true;
      onLong();
    }, 500);
  };
  const cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
  };
  return {
    onPointerDown: start,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onClickCapture: (e: React.MouseEvent) => {
      if (fired) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
  };
}

/** 表示状態には仮ID（'charged'）が混ざることがあるので安全に引く */
function safeCard(id: string) {
  try {
    return cardById(id);
  } catch {
    return null;
  }
}

/** バトルで使う画像を全て先読みする（カード表示のコンマ数秒の遅れを無くす） */
function preloadBattleImages(setup: BattleSetup): Promise<void> {
  const names = new Set<string>(['back', 'vfx_damage', 'vfx_heal', 'vfx_attr', 'vfx_lock', 'vfx_guard']);
  const addCard = (id: string) => {
    names.add(id);
    const card = safeCard(id);
    if (!card) return;
    const attrs = card.type === 'character' ? card.attribute : card.type === 'skill' ? card.conditionAttribute : [];
    for (const a of attrs) {
      names.add(a); // 属性アイコン
      names.add(`vfx_${a}`); // 属性VFX
    }
  };
  for (const deck of [setup.playerDeck, setup.enemy.deck]) {
    deck.characterIds.forEach(addCard);
    deck.cardIds.forEach(addCard);
  }
  const loadOne = (name: string) =>
    new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve(); // 無い画像（css製VFX等）は気にしない
      img.src = IMG(name);
    });
  const all = Promise.all([...names].map(loadOne)).then(() => undefined);
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, 10000)); // 保険
  return Promise.race([all, timeout]);
}

export function Battle(props: { setup: BattleSetup; onExit: () => void; onRematch: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    setReady(false);
    preloadSfx(ALL_SFX); // 効果音も先に読み込む
    preloadBattleImages(props.setup).then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [props.setup]);

  if (!ready) {
    return (
      <div className="battle-loading">
        <img className="loading-emblem" src={IMG('icon_sword')} alt="" />
        <p>デュエル準備中…</p>
      </div>
    );
  }
  return <BattleInner {...props} />;
}

function BattleInner({ setup, onExit, onRematch }: {
  setup: BattleSetup;
  onExit: () => void;
  onRematch: () => void;
}) {
  const { state, view, busy, current, pops, koShown, perform, myActions, isMyTurn, speed, setSpeed } = useBattle(setup.playerDeck, setup.enemy.deck);
  const [previewHand, setPreviewHand] = useState<number | null>(null);
  const [zoomCard, setZoomCard] = useState<string | null>(null); // 読み取り専用の拡大表示（カードID）
  const [pileList, setPileList] = useState<{ title: string; cards: string[] } | null>(null);
  const [chargeSel, setChargeSel] = useState<Set<number>>(new Set());
  const [targeting, setTargeting] = useState<Targeting>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [sfxOn, setSfxOn] = useState(isSfxEnabled());

  const vh = useViewportHeight();
  const cardW = cardWidthFor(vh, window.innerWidth);
  const handW = Math.round(cardW * 0.78);
  const me = view.players[PLAYER]; // 盤面は表示用ステートを映す
  const foe = view.players[ENEMY];
  const finished = state.phase === 'finished';
  const guardPhase = state.phase === 'guard' && isMyTurn && !busy;

  // 飛翔演出のアンカー
  const deckRefP = useRef<HTMLDivElement>(null);
  const deckRefE = useRef<HTMLDivElement>(null);
  const apRefP = useRef<HTMLDivElement>(null);
  const apRefE = useRef<HTMLDivElement>(null);
  const trashRefP = useRef<HTMLDivElement>(null);
  const trashRefE = useRef<HTMLDivElement>(null);
  const handRefP = useRef<HTMLDivElement>(null);
  const handRefE = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const deckRefs = [deckRefP, deckRefE];
  const apRefs = [apRefP, apRefE];
  const trashRefs = [trashRefP, trashRefE];
  const handRefs = [handRefP, handRefE];

  function centerOf(el: HTMLElement | null): { x: number; y: number } | null {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function spawnFlight(fromEl: HTMLElement | null, toEl: HTMLElement | null, count = 1, faceCardId?: string) {
    const from = centerOf(fromEl);
    const to = centerOf(toEl);
    if (!from || !to) return;
    playSfx('se_card', 0.3); // カードが擦れて滑る音
    for (let i = 0; i < Math.min(count, 3); i++) {
      const f: Flight = { key: flightKey++, from, to, faceCardId };
      window.setTimeout(() => {
        setFlights((prev) => [...prev, f]);
        window.setTimeout(() => setFlights((prev) => prev.filter((x) => x.key !== f.key)), 700);
      }, i * 130);
    }
  }

  // スキルの属性を覚えておき、続くダメージ等のVFXに使う
  const lastAttrsRef = useRef<string[]>([]);
  // 直近でスキルを使ったキャラ（カード効果の発動プレートを出す先）
  const lastCasterRef = useRef<{ side: 0 | 1; charIndex: number } | null>(null);
  interface Vfx { key: number; side: 0 | 1; charIndex: number; img: string; delay: number }
  const [vfxList, setVfxList] = useState<Vfx[]>([]);

  /** imgs: 画像VFX名、または 'css:クラス名'（CSSだけのエフェクト） */
  function spawnVfx(side: 0 | 1 | undefined, charIndex: number | undefined, imgs: string[]) {
    if (side === undefined || charIndex === undefined) return;
    const spawned: Vfx[] = imgs.map((img, i) => ({ key: flightKey++, side, charIndex, img, delay: i * 170 }));
    setVfxList((prev) => [...prev, ...spawned]);
    window.setTimeout(() => {
      setVfxList((prev) => prev.filter((v) => !spawned.includes(v)));
    }, 1100 + imgs.length * 170);
  }

  // キャラの頭上に出る小さなプレート（能力発動・威力アップ・ガード結果など）
  // 位置は出す瞬間に固定する（後から並び直すとガタガタ動いて見えるため）
  interface Plate { key: number; side: 0 | 1; charIndex: number; text: string; cls: string; offset: number; icon?: string }
  const [plates, setPlates] = useState<Plate[]>([]);

  function spawnPlate(side: 0 | 1 | undefined, charIndex: number | undefined, text: string, cls = '', life = 1500, icon?: string) {
    if (side === undefined || charIndex === undefined) return;
    setPlates((prev) => {
      const offset = prev.filter((p) => p.side === side && p.charIndex === charIndex).length * 26;
      const plate: Plate = { key: flightKey++, side, charIndex, text, cls, offset, icon };
      window.setTimeout(() => setPlates((pp) => pp.filter((p) => p.key !== plate.key)), life);
      return [...prev, plate];
    });
  }

  // ナレーションイベントに合わせて「カードが飛ぶ」物理演出
  useEffect(() => {
    if (!current) return;
    const s = (current.side ?? PLAYER) as 0 | 1;
    // 全演出の効果音（イベント種 → [SE名, 音量]）
    const SFX_BY_KIND: Partial<Record<NarrEvent['kind'], [string, number]>> = {
      draw: ['se_draw', 0.4],
      charge: ['se_card', 0.35],
      chargeDeck: ['se_card', 0.35],
      chargeTrash: ['se_card', 0.35],
      chargeAll: ['se_card', 0.4],
      mill: ['se_card', 0.3],
      apTrash: ['se_card', 0.3],
      handTrash: ['se_card', 0.3],
      search: ['se_draw', 0.4],
      play: ['se_play', 0.5],
      field: ['se_play', 0.5],
      attack: ['se_attack', 0.55],
      guard: ['se_guard', 0.55],
      damage: ['se_damage', 0.6],
      heal: ['se_heal', 0.5],
      revive: ['se_heal', 0.55],
      ko: ['se_ko', 0.65],
      ability: ['se_ability', 0.45],
      power: ['se_ability', 0.45],
      powerGuard: ['se_ability', 0.45],
      attr: ['se_ability', 0.4],
      actor: ['se_actor', 0.5],
      equip: ['se_equip', 0.5],
      lock: ['se_lock', 0.5],
      unlock: ['se_lock', 0.4],
      turn: ['se_turn', 0.5],
      coin: ['se_coin', 0.55],
      end: ['se_end', 0.6],
    };
    const se = SFX_BY_KIND[current.kind];
    if (se) playSfx(se[0], se[1]);
    switch (current.kind) {
      case 'draw':
        spawnFlight(deckRefs[s].current, handRefs[s].current, current.amount ?? 1);
        break;
      case 'charge':
        spawnFlight(handRefs[s].current, apRefs[s].current, 1);
        break;
      case 'chargeDeck':
        spawnFlight(deckRefs[s].current, apRefs[s].current, current.amount ?? 1);
        break;
      case 'chargeTrash':
        spawnFlight(trashRefs[s].current, apRefs[s].current, current.amount ?? 1);
        break;
      case 'chargeAll':
        spawnFlight(handRefs[s].current, apRefs[s].current, current.amount ?? 1);
        break;
      case 'mill':
        spawnFlight(deckRefs[s].current, trashRefs[s].current, current.amount ?? 1);
        break;
      case 'apTrash':
        spawnFlight(apRefs[s].current, trashRefs[s].current, current.amount ?? 1);
        break;
      case 'handTrash':
        spawnFlight(handRefs[s].current, trashRefs[s].current, current.amount ?? 1);
        break;
      case 'play':
      case 'guard':
        // このスキルの属性を記憶（後続のダメージ等のVFXに使う）
        if (current.card?.type === 'skill') {
          lastAttrsRef.current = [...new Set(current.card.conditionAttribute)];
        } else {
          lastAttrsRef.current = [];
        }
        // 使用キャラに「詠唱」エフェクト（属性の光 + 立ち上る詠唱リング）
        // ガードはガード専用の盾VFX
        if (current.charIndex !== undefined && current.side !== undefined) {
          lastCasterRef.current = { side: current.side, charIndex: current.charIndex };
          spawnVfx(
            current.side,
            current.charIndex,
            current.kind === 'guard'
              ? ['vfx_guard', 'css:pguard']
              : ['css:cast', ...lastAttrsRef.current.slice(0, 2).map((a) => `vfx_${a}`)],
          );
        }
        // ガードは「いくつ → いくつ」を頭上に大きく出す
        if (current.kind === 'guard' && current.amountBefore !== undefined) {
          spawnPlate(current.side, current.charIndex, `${current.amountBefore} → ${current.amount}`, 'guard', 1900, 'icon_shield');
        }
        // カットインのあと、使ったカードがトラッシュへ飛ぶ
        window.setTimeout(() => {
          spawnFlight(boardRef.current, trashRefs[s].current, 1, current.card?.id);
        }, Math.max(0, current.duration - 420));
        break;
      case 'turn':
        lastAttrsRef.current = [];
        break;
      case 'damage':
        spawnVfx(current.side, current.charIndex, [...lastAttrsRef.current.map((a) => `vfx_${a}`), 'vfx_damage']);
        break;
      case 'heal':
        spawnVfx(current.side, current.charIndex, [...lastAttrsRef.current.map((a) => `vfx_${a}`), 'vfx_heal']);
        break;
      case 'attr':
        spawnVfx(current.side, current.charIndex, [current.attr ? `vfx_${current.attr}` : '', 'vfx_attr'].filter(Boolean));
        spawnPlate(current.side, current.charIndex, `＋${current.attr}属性`, 'attr');
        break;
      case 'lock':
        spawnVfx(current.side, current.charIndex, [...lastAttrsRef.current.map((a) => `vfx_${a}`), 'vfx_lock']);
        spawnPlate(current.side, current.charIndex, 'ロック', 'lock', 1500, 'icon_lock');
        break;
      case 'unlock':
        spawnPlate(current.side, current.charIndex, 'ロック解除', 'lock', 1500, 'icon_lock');
        break;
      case 'ability': {
        // パッシブ発動: エンジンが明示した位置にだけ出す（推測して間違った側に出さない）
        if (current.charIndex !== undefined && current.side !== undefined) {
          spawnPlate(current.side, current.charIndex, current.text.replace(/！$/, ''), 'passive', 1700, 'icon_bolt');
          spawnVfx(current.side, current.charIndex, ['css:passive']);
        }
        break;
      }
      case 'power':
        spawnPlate(current.side, current.charIndex, `威力+${current.amount}`, 'power', 1400, 'icon_sword');
        spawnVfx(current.side, current.charIndex, ['css:power']);
        break;
      case 'powerGuard':
        spawnPlate(current.side, current.charIndex, `ガード+${current.amount}`, 'pguard', 1400, 'icon_shield');
        spawnVfx(current.side, current.charIndex, ['css:pguard']);
        break;
      case 'info':
        if (current.charName === '無傷') {
          spawnPlate(current.side, current.charIndex, '無傷！', 'miss', 1300);
        }
        break;
      case 'search':
        spawnFlight(deckRefs[s].current, handRefs[s].current, 1);
        break;
      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.key]);

  // フェーズが変わったら選択状態をリセット
  useEffect(() => {
    setChargeSel(new Set());
    setPreviewHand(null);
  }, [state.phase, isMyTurn]);

  // 手札の長押しピーク: 押している間だけ拡大。指を横に滑らせると隣のカードに切り替わる
  const peekTimerRef = useRef(0);
  const peekingRef = useRef(false);
  const peekedRecentlyRef = useRef(false);

  function handIndexFromX(clientX: number): number | null {
    const el = handRefP.current;
    const n = me.hand.length;
    if (!el || n === 0) return null;
    const r = el.getBoundingClientRect();
    const step = Math.round(handW * 0.63);
    const idx = Math.round((clientX - (r.left + r.width / 2)) / step + (n - 1) / 2);
    return Math.max(0, Math.min(n - 1, idx));
  }

  const handPeek = {
    onPointerDown: (e: React.PointerEvent) => {
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        /* すでに解放済みのポインタなどは無視 */
      }
      const x = e.clientX;
      window.clearTimeout(peekTimerRef.current);
      peekTimerRef.current = window.setTimeout(() => {
        peekingRef.current = true;
        peekedRecentlyRef.current = true;
        const idx = handIndexFromX(x);
        if (idx !== null && me.hand[idx]) setZoomCard(me.hand[idx]);
      }, 450);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!peekingRef.current) return;
      const idx = handIndexFromX(e.clientX);
      if (idx !== null && me.hand[idx]) setZoomCard(me.hand[idx]);
    },
    onPointerUp: () => {
      window.clearTimeout(peekTimerRef.current);
      if (peekingRef.current) {
        peekingRef.current = false;
        setZoomCard(null);
        window.setTimeout(() => { peekedRecentlyRef.current = false; }, 80);
      }
    },
    onPointerCancel: () => {
      window.clearTimeout(peekTimerRef.current);
      peekingRef.current = false;
      setZoomCard(null);
    },
    onClickCapture: (e: React.MouseEvent) => {
      // 長押しピークの直後のクリックは「カードを選んだ」扱いにしない
      if (peekedRecentlyRef.current) {
        e.stopPropagation();
        e.preventDefault();
        peekedRecentlyRef.current = false;
      }
    },
  };

  const handPlayable = useMemo(() => {
    const map = new Map<number, BattleAction[]>();
    for (const a of myActions) {
      if ('handIndex' in a) {
        const list = map.get(a.handIndex) ?? [];
        list.push(a);
        map.set(a.handIndex, list);
      }
    }
    return map;
  }, [myActions]);

  function act(action: BattleAction) {
    setPreviewHand(null);
    setTargeting(null);
    try {
      perform(action);
    } catch (e) {
      console.warn(e);
    }
  }

  /** プレビュー中のカードを使う（必要なら対象選択モードへ）。
   * 選べる対象は合法手（legalActions）から導出するので、選択肢の抜けが起きない */
  function playFromPreview(handIndex: number) {
    const card = cardById(me.hand[handIndex]);
    setPreviewHand(null);

    // このカードに対応する合法手を集める
    const acts = myActions.filter((a) => 'handIndex' in a && a.handIndex === handIndex);
    if (acts.length === 0) return;
    if (acts.length === 1 && !('targetIndex' in acts[0] && card.type === 'equipment')) {
      // 対象の選びようがない（1通りしかない）場合は即実行
      const only = acts[0];
      const needsChoice =
        (only.type === 'playSkill' && (only.healTargetIndex !== undefined || only.targetIndex !== undefined || only.usingIndex !== undefined)) ||
        only.type === 'playEquipment';
      if (!needsChoice) return act(only);
    }

    // 対象→行動 の表を作る
    const map = new Map<number, BattleAction>();
    let side: 0 | 1 = PLAYER;
    let hint = '対象を選んでください';
    for (const a of acts) {
      if (a.type === 'playSkill' && a.targetIndex !== undefined) {
        map.set(a.targetIndex, a);
        side = ENEMY;
        hint = '攻撃する相手を選んでください';
      } else if (a.type === 'playSkill' && a.healTargetIndex !== undefined) {
        map.set(a.healTargetIndex, a);
        side = PLAYER;
        hint = '回復する味方を選んでください';
      } else if (a.type === 'playSkill' && a.usingIndex !== undefined) {
        map.set(a.usingIndex, a);
        side = PLAYER;
        hint = 'このスキルを使うキャラを選んでください';
      } else if (a.type === 'playEquipment') {
        map.set(a.targetIndex, a);
        side = PLAYER;
        hint = '装備するキャラを選んでください';
      }
    }
    if (map.size === 0) {
      act(acts[0]);
      return;
    }
    if (map.size === 1) {
      act([...map.values()][0]);
      return;
    }
    setTargeting({ side, hint, actions: map });
  }

  function tapChar(side: 0 | 1, index: number) {
    if (!targeting) return;
    if (side !== targeting.side) return;
    const action = targeting.actions.get(index);
    if (action) act(action);
  }

  function tapHand(i: number) {
    if (finished || !isMyTurn || busy) return;
    if (state.phase === 'charge') {
      // まとめて選択 → あとで確定
      setChargeSel((prev) => {
        const next = new Set(prev);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        return next;
      });
      return;
    }
    setTargeting(null);
    setPreviewHand(i);
  }

  /** 選んだカードをまとめてチャージして、そのままターンエンド */
  function chargeSelectedAndEndTurn() {
    const indexes = [...chargeSel].sort((a, b) => b - a);
    setChargeSel(new Set());
    try {
      for (const i of indexes) {
        perform({ type: 'charge', handIndex: i });
      }
      perform({ type: 'endTurn' });
    } catch (e) {
      console.warn(e);
    }
  }

  const fieldCard = view.field ? cardById(view.field.cardId) : null;

  const choicePhase = state.phase === 'choice' && isMyTurn && !busy;

  return (
    <div className={`battle-root ${finished ? '' : isMyTurn ? 'my-turn' : 'enemy-turn'} ${targeting ? 'targeting-mode' : ''}`}>
      {/* ターンバッジ（常時表示） */}
      {!finished && (
        <div className={`turn-badge ${isMyTurn ? 'mine' : 'theirs'}`}>
          {isMyTurn ? 'あなたのターン' : '相手のターン'}
        </div>
      )}
      {/* 相手情報バー（表層UI） */}
      <div className="info-bar">
        <span className="deck-name"><em className="vs">vs</em> {setup.enemy.name}</span>
        <span className="phase-pill">
          <b className="turn-num">T{state.turn}</b>
          {isMyTurn ? (
            <>
              <em className={state.phase === 'play' || state.phase === 'choice' ? 'on' : ''}>メイン</em>
              <em className={state.phase === 'charge' ? 'on' : ''}>チャージ</em>
            </>
          ) : (
            <em className="theirs on">相手</em>
          )}
        </span>
        <button
          className={`chip small speed ${speed > 1 ? 'on' : ''}`}
          onClick={() => setSpeed(speed > 1 ? 1 : 2)}
          title="演出の速さを切り替え"
        >
          {speed > 1 ? '×2' : '×1'}
        </button>
        <button
          className={`chip small speed ${sfxOn ? 'on' : ''}`}
          onClick={() => {
            const next = !sfxOn;
            setSfxEnabled(next);
            setSfxOn(next);
            if (next) playSfx('se_ability', 0.4);
          }}
          title="効果音のオン/オフ"
        >
          音
        </button>
        <button className="chip small" onClick={() => setShowRules(true)}>？</button>
        <button className="chip small danger" onClick={() => setConfirmExit(true)}>投了</button>
      </div>

      {/* 盤面（3Dに傾くテーブル） */}
      <div className="board-wrap">
        <div className="board" ref={boardRef}>
          {/* 相手の手札（裏向きの扇） */}
          {/* 相手の手札: 自分と同じ扇状で、枚数がひと目でわかる間隔にする */}
          <div className="enemy-hand" ref={handRefE}>
            {foe.hand.map((_, i) => {
              const off = i - (foe.hand.length - 1) / 2;
              return (
                <img
                  key={i}
                  src={IMG('back')}
                  className="hand-back"
                  style={{
                    left: `calc(50% + ${Math.round(off * 24)}px)`,
                    zIndex: i,
                    transform: `translateX(-50%) translateY(${Math.round(off * off * 1.2)}px) rotate(${180 - off * 5}deg)`,
                  }}
                />
              );
            })}
          </div>

          {/* 相手エリア: 左にゾーン（鏡写し）、右に陣形 */}
          <div className="area enemy-area">
            <ZoneCol
              side={ENEMY} p={foe} deckRef={deckRefE} apRef={apRefE} trashRef={trashRefE}
              onOpenPile={(kind) => {
                if (kind === 'trash') setPileList({ title: '相手のトラッシュ', cards: foe.trash });
              }}
            />
            <Formation
              side={ENEMY} state={view} pops={pops} targeting={targeting}
              onTap={tapChar} koShown={koShown} cardW={cardW} vfxList={vfxList}
              plates={plates} onZoom={setZoomCard}
            />
          </div>

          {/* 中央: フィールドのみ（ガイドテキストは廃止。すべて演出で伝える） */}
          <div className="center-strip">
            <div className="field-slot">
              {fieldCard ? <CardFrame card={fieldCard} width={40} /> : <div className="field-empty">FIELD</div>}
            </div>
          </div>

          {/* 自分エリア: 左に陣形、右にゾーン（山札が一番右） */}
          <div className="area my-area">
            <Formation
              side={PLAYER} state={view} pops={pops} targeting={targeting}
              onTap={tapChar} koShown={koShown} cardW={cardW} vfxList={vfxList}
              plates={plates} onZoom={setZoomCard}
            />
            <ZoneCol
              side={PLAYER} p={me} deckRef={deckRefP} apRef={apRefP} trashRef={trashRefP}
              onOpenPile={(kind) => {
                if (kind === 'trash') setPileList({ title: '自分のトラッシュ', cards: me.trash });
                if (kind === 'ap') setPileList({ title: '自分のAPエリア', cards: me.ap });
              }}
            />
          </div>
        </div>
      </div>

      {/* 自分の手札（扇状に持つ。カードの増減はキーを固定してなめらかに詰める） */}
      <div className="my-hand" ref={handRefP} style={{ height: Math.round(handW * 1.72) }}>
        {(() => {
          const seen = new Map<string, number>();
          const n = me.hand.length;
          const step = Math.round(handW * 0.63);
          return me.hand.map((id, i) => {
            // 同名カードは「何枚目か」でキーを固定する（indexキーだと全カードが
            // 再マウントされて手札全体がガタつく）
            const nth = seen.get(id) ?? 0;
            seen.set(id, nth + 1);
            const card = safeCard(id);
            if (!card) return null;
            const playable = isMyTurn && state.phase === 'play' && handPlayable.has(i);
            const chargeable = isMyTurn && state.phase === 'charge' && !busy;
            const picked = chargeSel.has(i);
            const showCost = card.type === 'skill' && isMyTurn && state.phase === 'play' && !busy;
            const lackAp = card.type === 'skill' && me.ap.length < card.costAp;
            const off = i - (n - 1) / 2;
            const arcRot = off * 4;
            const arcY = off * off * 2.4 + (picked ? -26 : 0);
            return (
              <div
                key={`${id}#${nth}`}
                className={[
                  'hand-card',
                  picked ? 'raised' : '',
                  playable || chargeable ? 'playable' : '',
                ].join(' ')}
                style={{
                  left: `calc(50% + ${Math.round(off * step)}px)`,
                  top: 8,
                  zIndex: i,
                  transform: `translateX(-50%) rotate(${arcRot}deg) translateY(${Math.round(arcY)}px)${picked ? ' scale(1.08)' : ''}`,
                  transformOrigin: '50% 115%',
                }}
                onClick={() => tapHand(i)}
                {...handPeek}
              >
                <CardFrame card={card} width={handW} upright />
                {picked && <img className="pick-badge" src={IMG('icon_bolt')} alt="チャージ予定" />}
                {showCost && (
                  <span className={`cost-chip ${lackAp ? 'lack' : ''}`} title={lackAp ? 'APが足りない' : `コスト${card.costAp}`}>
                    {card.costAp}
                  </span>
                )}
              </div>
            );
          });
        })()}
      </div>

      {/* アクションバー */}
      <div className="action-bar">
        {busy ? (
          <span className="hint">…</span>
        ) : targeting ? (
          <>
            <span className="hint">{targeting.hint}</span>
            <button className="chip" onClick={() => setTargeting(null)}>やめる</button>
          </>
        ) : state.phase === 'choice' ? (
          <span className="hint">ターン開始の能力を選択中…</span>
        ) : guardPhase ? (
          <span className="hint danger">相手の攻撃！ ガードで割り込めます</span>
        ) : !isMyTurn || finished ? (
          <span className="hint">{finished ? 'バトル終了' : '相手のターン…'}</span>
        ) : state.phase === 'play' ? (
          <button
            className={`chip next-phase ${handPlayable.size === 0 ? 'attention' : ''}`}
            onClick={() => act({ type: 'endPlay' })}
          >
            チャージへ →
          </button>
        ) : (
          <>
            {chargeSel.size > 0 ? (
              <>
                <button className="big-btn slim" onClick={chargeSelectedAndEndTurn}>
                  {chargeSel.size}枚チャージしてターンエンド
                </button>
                <button className="chip" onClick={() => setChargeSel(new Set())}>選び直す</button>
              </>
            ) : (
              <button className="chip" onClick={() => act({ type: 'endTurn' })}>チャージせずターンエンド</button>
            )}
          </>
        )}
      </div>

      {/* ターン開始の選択（アニマ等。ドロー前に1回だけ） */}
      {choicePhase && (
        <div className="overlay">
          <div className="dialog">
            <p>ターン開始の能力を使いますか？</p>
            <div className="dialog-btns" style={{ flexDirection: 'column', gap: 8 }}>
              {myActions.filter((a) => a.type === 'turnStartAbility').map((a) => {
                const ci = (a as { charIndex: number }).charIndex;
                const name = me.characters[ci]?.name.replace(/^\[[^\]]*\]/, '') ?? '';
                return (
                  <button key={ci} className="big-btn slim" onClick={() => act(a)}>
                    {name}をアクターにする
                  </button>
                );
              })}
              <button className="chip" onClick={() => act({ type: 'skipTurnStart' })}>使わない</button>
            </div>
          </div>
        </div>
      )}

      {/* ガード割り込みシート */}
      {guardPhase && state.pendingAttack && (
        <div className="guard-sheet">
          <p className="guard-title">
            「{state.pendingAttack.skillName}」 が来る！（ダメージ {state.pendingAttack.value}）
          </p>
          <div className="guard-options">
            {myActions.filter((a) => a.type === 'playGuard').map((a) => {
              const hi = (a as { handIndex: number }).handIndex;
              return (
                <div key={hi} className="hand-card playable" onClick={() => act(a)}>
                  <CardFrame card={cardById(me.hand[hi])} width={handW} />
                </div>
              );
            })}
          </div>
          <button className="big-btn slim" onClick={() => act({ type: 'pass' })}>そのまま受ける</button>
        </div>
      )}

      {/* テキスト表示はターン・先攻・決着のみ。ほかは全部その場の演出で伝える */}
      {current && current.kind === 'turn' && <TurnSplash key={current.key} mine={current.side === PLAYER} text={current.text} />}
      {current && ['coin', 'end'].includes(current.kind) && <NarrationBanner ev={current} />}
      {current && current.card && ['play', 'guard', 'field', 'equip'].includes(current.kind) && (
        <div className={`reveal ${current.side === ENEMY ? 'from-top' : 'from-bottom'}`}>
          <CardFrame card={current.card} width={190} />
        </div>
      )}

      {/* 飛んでいくカード */}
      {flights.map((f) => <FlyGhost key={f.key} flight={f} />)}

      {/* 手札カードの拡大プレビュー */}
      {previewHand !== null && previewHand < me.hand.length && (
        <div className="overlay preview" onClick={() => setPreviewHand(null)}>
          <div className="preview-inner" onClick={(e) => e.stopPropagation()}>
            <CardFrame card={cardById(me.hand[previewHand])} width={Math.min(300, Math.max(230, window.innerWidth * 0.72))} upright />
            {(() => {
              // 今使ったらどうなるか（状況で変わるスキルの予想値）
              const card = cardById(me.hand[previewHand]);
              if (card.type !== 'skill' || !isMyTurn) return null;
              const p = predictSkill(state, PLAYER, card);
              if (!p) return null;
              return (
                <div className="predict-row">
                  {p.kind === 'attack' && (
                    <span className="predict atk">
                      予想ダメージ <b>{p.value}</b>
                      {p.targets > 1 && <em>×{p.targets}体</em>}
                      {p.value !== card.baseValue && <em className="mod">（基本{card.baseValue}）</em>}
                    </span>
                  )}
                  {p.kind === 'heal' && <span className="predict heal">回復量 <b>{p.value}</b></span>}
                  {p.kind === 'guard' && <span className="predict grd">ガード軽減 <b>{p.value}</b></span>}
                  <span className="predict cost">
                    コスト <b>{p.cost}</b>
                    {p.cost !== card.costAp && <em className="mod">（基本{card.costAp}）</em>}
                  </span>
                </div>
              );
            })()}
            <div className="dialog-btns">
              {handPlayable.has(previewHand) ? (
                <button className="big-btn slim" onClick={() => playFromPreview(previewHand)}>このカードを使う</button>
              ) : (
                <span className="hint">{state.phase === 'play' ? '今は使えないカード（APや属性を確認）' : ''}</span>
              )}
              <button className="chip" onClick={() => setPreviewHand(null)}>とじる</button>
            </div>
          </div>
        </div>
      )}

      {/* 読み取り専用の拡大表示（盤面キャラ・装備・トラッシュなど） */}
      {zoomCard && safeCard(zoomCard) && (
        <div className="overlay preview" onClick={() => setZoomCard(null)}>
          <div className="preview-inner" onClick={(e) => e.stopPropagation()}>
            <CardFrame card={safeCard(zoomCard)!} width={Math.min(300, Math.max(230, window.innerWidth * 0.72))} upright />
            <button className="chip" onClick={() => setZoomCard(null)}>とじる</button>
          </div>
        </div>
      )}

      {/* トラッシュ・APのリスト表示 */}
      {pileList && (
        <div className="overlay" onClick={() => setPileList(null)}>
          <div className="dialog pile-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{pileList.title}（{pileList.cards.length}枚）</h3>
            <div className="pile-grid">
              {pileList.cards.length === 0 && <p className="hint">まだカードがありません</p>}
              {[...pileList.cards].reverse().map((id, i) =>
                safeCard(id) ? (
                  <div key={`${id}-${i}`} className="pile-grid-card" onClick={() => setZoomCard(id)}>
                    <CardFrame card={safeCard(id)!} width={72} upright />
                  </div>
                ) : null,
              )}
            </div>
            <button className="chip" onClick={() => setPileList(null)}>とじる</button>
          </div>
        </div>
      )}

      {/* ルール説明 */}
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}

      {/* 投了確認 */}
      {confirmExit && (
        <div className="overlay">
          <div className="dialog">
            <p>バトルをやめてホームに戻りますか？</p>
            <div className="dialog-btns">
              <button className="chip" onClick={() => setConfirmExit(false)}>続ける</button>
              <button className="big-btn slim" onClick={onExit}>投了する</button>
            </div>
          </div>
        </div>
      )}

      {/* リザルト（演出が終わってから） */}
      {finished && !busy && <ResultOverlay state={state} setup={setup} onExit={onExit} onRematch={onRematch} />}
    </div>
  );
}

// ---------------------------------------------------------------- 陣形

/**
 * キャラクターの陣形（リボルバー式）。
 * キャラをホイール上に等間隔で配置し、アクター交代時はホイールごと回転して
 * リボルバーのように入れ替わる。アクター位置（中央側）のカードは大きく表示。
 */
function Formation({ side, state, pops, targeting, onTap, koShown, cardW, vfxList, plates, onZoom }: {
  side: 0 | 1;
  state: BattleState;
  pops: DamagePop[];
  targeting: Targeting;
  onTap: (side: 0 | 1, index: number) => void;
  koShown: Set<string>;
  cardW: number;
  vfxList: { key: number; side: 0 | 1; charIndex: number; img: string; delay: number }[];
  plates: { key: number; side: 0 | 1; charIndex: number; text: string; cls: string; offset: number; icon?: string }[];
  onZoom?: (cardId: string) => void;
}) {
  const p = state.players[side];
  const n = p.characters.length;
  const step = 360 / Math.max(n, 1);
  // 横長の楕円ホイール: 横方向に大きく広げ、縦はつぶして省スペースにする。
  // 空いた縦の余白ぶんカード自体を大きくできる。
  const rx = Math.round(cardW * 1.12); // 横半径
  const ry = Math.round(cardW * 0.5); // 縦半径
  const frontW = Math.round(cardW * 1.08);
  const backScale = 0.8;

  // 前面 = 中央（相手側）寄り。自分は上向き、相手は下向き
  // 配置順: アクター=前、1控え=左、2控え=右（基準角を -i*step にすることで実現）
  const frontAngle = side === PLAYER ? 0 : 180;
  const tilt = n === 2 ? 28 : 0; // 2人の時は斜めに
  const desired = p.actorIndex * step;

  // 回転は常に同じ方向（進行方向）へ。1控えへも2控えへも同方向に回る
  const rotRef = useRef(desired);
  const prev = rotRef.current;
  const forward = ((desired - prev) % 360 + 360) % 360;
  const wheelRot = prev + forward;
  useEffect(() => {
    rotRef.current = wheelRot;
  });

  const width = Math.round(cardW * 2.95 + 8);
  const height = Math.round(cardW * 2.2 + 16);
  const selectableSet = targeting && targeting.side === side ? targeting.actions : null;

  return (
    <div className="formation" style={{ width, height }}>
      {p.characters.map((c, i) => {
        const alive = isCharAlive(state, side, i);
        const koVisible = koShown.has(`${side}-${i}`);
        const isActor = p.actorIndex === i && alive;
        const maxHp = maxHpOf(state, side, i);
        const hp = Math.max(0, maxHp - c.damage);
        const hpRatio = maxHp > 0 ? hp / maxHp : 0;
        const myPops = pops.filter((d) => d.side === side && d.charIndex === i);
        const myVfx = vfxList.filter((v) => v.side === side && v.charIndex === i);
        const extras = extraAttributes(state, side, i);
        const A = frontAngle - i * step + wheelRot + tilt;
        const rad = (A * Math.PI) / 180;
        const x = Math.round(Math.sin(rad) * rx * 10) / 10;
        const y = Math.round(-Math.cos(rad) * ry * 10) / 10;
        const scale = isActor ? 1 : backScale;
        return (
          <div
            key={c.cardId + i}
            data-slot={`${side}-${i}`}
            className={[
              'char-slot',
              'wheel-slot',
              isActor ? 'actor' : '',
              koVisible ? 'ko' : '',
              selectableSet?.has(i) ? 'selectable' : '',
            ].join(' ')}
            style={{
              left: '50%',
              top: '50%',
              zIndex: isActor ? 6 : 3,
              transform: `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`,
            }}
            onClick={() => onTap(side, i)}
            {...longPressHandlers(() => onZoom?.(c.cardId))}
          >
            <div className={myPops.some((d) => d.amount > 0) ? 'card-hit' : ''}>
              <CardFrame card={cardById(c.cardId)} width={frontW} />
            </div>
            {koVisible && <img src={IMG('back')} className="ko-back" />}
            {isActor && state.turn <= p.actorLockUntilTurn && (
              <img className="lock-badge" src={IMG('icon_lock')} title="ロック中: アクターを交代できない" alt="ロック" />
            )}
            {c.equipmentCardId && (
              <span
                className="equip-thumb"
                title="装備（タップで拡大）"
                onClick={(e) => {
                  e.stopPropagation();
                  onZoom?.(c.equipmentCardId!);
                }}
              >
                <img src={IMG(c.equipmentCardId)} alt="装備" />
              </span>
            )}
            {alive && (
              <div className="char-status">
                <div className="hp-bar">
                  <div
                    className={`hp-fill ${hpRatio <= 0.25 ? 'low' : hpRatio <= 0.5 ? 'mid' : ''}`}
                    style={{ width: `${Math.round(hpRatio * 100)}%` }}
                  />
                </div>
                <div className="status-row">
                  <span className="hp-num">{hp}/{maxHp}</span>
                  <span className="attr-icons">
                    {(cardById(c.cardId) as CharacterCard).attribute.slice(0, 5).map((a, k) => (
                      <img key={`b${k}`} src={IMG(a)} alt={a} title={`属性: ${a}`} />
                    ))}
                    {extras.slice(0, 3).map((a, k) => (
                      <img key={`x${k}`} className="added" src={IMG(a)} alt={a} title={`追加属性: ${a}`} />
                    ))}
                  </span>
                </div>
              </div>
            )}
            {myVfx.map((v) =>
              v.img.startsWith('css:') ? (
                <span
                  key={v.key}
                  className={`fx-css fx-${v.img.slice(4)}`}
                  style={{ animationDelay: `${v.delay}ms` }}
                />
              ) : (
                <img
                  key={v.key}
                  className="vfx-burst"
                  src={IMG(v.img)}
                  style={{ animationDelay: `${v.delay}ms`, transform: `rotate(${(v.key * 47) % 40 - 20}deg)` }}
                  onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                />
              ),
            )}
            {plates
              .filter((pl) => pl.side === side && pl.charIndex === i)
              .map((pl) => (
                <span key={pl.key} className={`char-plate ${pl.cls}`} style={{ top: -26 - pl.offset }}>
                  {pl.icon && <img className="plate-ico" src={IMG(pl.icon)} alt="" />}
                  {pl.text}
                </span>
              ))}
            {myPops.map((d) => (
              <span key={d.key} className={d.amount > 0 ? 'pop dmg' : 'pop heal'}>
                {d.amount > 0 ? `-${d.amount}` : `+${-d.amount}`}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** 本来の属性に対して「追加されている」属性の一覧（装備・効果・味方付与など） */
function extraAttributes(state: BattleState, side: 0 | 1, i: number): string[] {
  const c = state.players[side].characters[i];
  const counts = new Map<string, number>();
  for (const a of c.attributes) counts.set(a, (counts.get(a) ?? 0) + 1);
  const extras: string[] = [];
  for (const a of effectiveAttributes(state, side, i)) {
    const left = counts.get(a) ?? 0;
    if (left > 0) counts.set(a, left - 1);
    else extras.push(a);
  }
  return extras;
}

// ---------------------------------------------------------------- ゾーン（縦積み・山札が端）

function ZoneCol({ side, p, deckRef, apRef, trashRef, onOpenPile }: {
  side: 0 | 1;
  p: BattleState['players'][number];
  deckRef: React.RefObject<HTMLDivElement>;
  apRef: React.RefObject<HTMLDivElement>;
  trashRef: React.RefObject<HTMLDivElement>;
  onOpenPile: (kind: 'ap' | 'trash') => void;
}) {
  const deck = (
    <div className="pile deck" ref={deckRef} key="deck">
      <img src={IMG('back')} className="pile-card" />
      <span className={`pile-count ${p.deck.length <= 10 ? 'low' : ''}`}>{p.deck.length}</span>
      <span className="pile-label">山札</span>
    </div>
  );
  const ap = (
    <div className="pile ap" ref={apRef} key="ap" onClick={() => onOpenPile('ap')}>
      <img src={IMG('back')} className="pile-card sideways" />
      <span className="pile-count gold">{p.ap.length}</span>
      <span className="pile-label">AP</span>
    </div>
  );
  const trash = (
    <div className="pile trash" ref={trashRef} key="trash" onClick={() => onOpenPile('trash')}>
      {p.trash.length > 0 ? (
        <div className="pile-card trash-top" style={{ backgroundImage: `url(${IMG(p.trash[p.trash.length - 1])})` }} />
      ) : (
        <div className="pile-card empty" />
      )}
      <span className="pile-count">{p.trash.length}</span>
      <span className="pile-label">トラッシュ</span>
    </div>
  );
  // 自分: 一番下（一番手前）が山札、その上にAP・トラッシュ。相手は鏡写し
  return (
    <div className={`zone-col ${side === ENEMY ? 'enemy' : ''}`}>
      {side === PLAYER ? [trash, ap, deck] : [deck, ap, trash]}
    </div>
  );
}

// ---------------------------------------------------------------- 演出部品

/** 飛んでいくカード（山札→手札、手札→AP、使用→トラッシュなど） */
function FlyGhost({ flight }: { flight: Flight }) {
  const [pos, setPos] = useState(flight.from);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setPos(flight.to));
    return () => cancelAnimationFrame(raf);
  }, [flight]);
  return (
    // left/top ではなく transform で動かす（レイアウト計算を起こさず、カクつかない）
    // 末尾の translate(-50%,-50%) はカード自身の中心合わせ（無いと半カード分ズレる）
    <div className="fly-ghost" style={{ transform: `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%)` }}>
      {flight.faceCardId ? (
        <div className="fly-face">
          <CardFrame card={cardById(flight.faceCardId)} width={54} />
        </div>
      ) : (
        <img src={IMG('back')} />
      )}
    </div>
  );
}

function NarrationBanner({ ev, mini = false }: { ev: NarrEvent; mini?: boolean }) {
  return (
    <div key={ev.key} className={`narration kind-${ev.kind} ${mini ? 'mini' : ''}`}>
      <span className="narr-text">{ev.text}</span>
    </div>
  );
}

/** ターン切り替えの全幅スプラッシュ演出 */
function TurnSplash({ mine, text }: { mine: boolean; text: string }) {
  return (
    <div className={`turn-splash ${mine ? 'mine' : 'theirs'}`}>
      <span>{text}</span>
    </div>
  );
}

function ResultOverlay({ state, setup, onExit, onRematch }: {
  state: BattleState;
  setup: BattleSetup;
  onExit: () => void;
  onRematch: () => void;
}) {
  const won = state.winner === PLAYER;
  const reason = state.endReason === 'wipeout' ? '全滅' : state.endReason === 'deckout' ? '山札切れ' : '時間切れ';
  const text = won
    ? `BRAVER'S DUEL β: 「${setup.playerDeckName}」で「${setup.enemy.name}」に勝利！（${reason}・${state.turn}ターン）`
    : `BRAVER'S DUEL β: 「${setup.enemy.name}」に敗北…リベンジ求む（${state.turn}ターン）`;
  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent('https://raccbigenner.github.io/bravers_duel/')}`;

  return (
    <div className="overlay">
      <div className={`dialog result ${won ? 'won' : 'lost'}`}>
        <h2 className={won ? 'win' : 'lose'}>{won ? 'VICTORY' : 'DEFEAT'}</h2>
        <p className="result-sub">{won ? '勝利！' : '敗北…'}</p>
        <div className="result-stats">
          <span className="stat"><b>{reason}</b><em>決着</em></span>
          <span className="stat"><b>{state.turn}</b><em>ターン</em></span>
          <span className="stat"><b>{setup.enemy.name}</b><em>対戦相手</em></span>
        </div>
        <a className="big-btn slim share" href={shareUrl} target="_blank" rel="noreferrer">
          𝕏 で結果をシェア
        </a>
        <div className="dialog-btns">
          <button className="chip" onClick={onExit}>ホームへ</button>
          <button className="big-btn slim" onClick={onRematch}>もう一回</button>
        </div>
      </div>
    </div>
  );
}
