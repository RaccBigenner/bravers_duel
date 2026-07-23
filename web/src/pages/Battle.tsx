import {
  cardById,
  effectiveAttributes,
  isCharAlive,
  maxHpOf,
  skillEffectOf,
  type BattleAction,
  type BattleState,
} from '@bravers/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BattleSetup } from '../App';
import { CardFrame } from '../CardFrame';
import { IMG } from '../cardAssets';
import type { NarrEvent } from '../battle/narrator';
import { useBattle, type DamagePop } from '../battle/useBattle';
import { RulesModal } from './RulesModal';
import '../battle.css';

const PLAYER = 0 as const;
const ENEMY = 1 as const;

type Targeting =
  | null
  | { kind: 'enemy'; handIndex: number }
  | { kind: 'allyHeal'; handIndex: number }
  | { kind: 'allyEquip'; handIndex: number }
  | { kind: 'allyUse'; handIndex: number }; // 控えから使うスキルの使用キャラ選択

/** 画面の高さ（リサイズ追従） */
function useViewportHeight(): number {
  const [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return vh;
}

function cardWidthFor(vh: number): number {
  if (vh >= 840) return 100;
  if (vh >= 760) return 92;
  if (vh >= 700) return 84;
  return 74;
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

export function Battle({ setup, onExit, onRematch }: {
  setup: BattleSetup;
  onExit: () => void;
  onRematch: () => void;
}) {
  const { state, view, busy, current, pops, koShown, perform, myActions, isMyTurn } = useBattle(setup.playerDeck, setup.enemy.deck);
  const [previewHand, setPreviewHand] = useState<number | null>(null);
  const [zoomCard, setZoomCard] = useState<string | null>(null); // 読み取り専用の拡大表示（カードID）
  const [pileList, setPileList] = useState<{ title: string; cards: string[] } | null>(null);
  const [chargeSel, setChargeSel] = useState<Set<number>>(new Set());
  const [targeting, setTargeting] = useState<Targeting>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [flights, setFlights] = useState<Flight[]>([]);

  const vh = useViewportHeight();
  const cardW = cardWidthFor(vh);
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
  interface Vfx { key: number; side: 0 | 1; charIndex: number; img: string; delay: number }
  const [vfxList, setVfxList] = useState<Vfx[]>([]);

  function spawnVfx(side: 0 | 1 | undefined, charIndex: number | undefined, imgs: string[]) {
    if (side === undefined || charIndex === undefined) return;
    const spawned: Vfx[] = imgs.map((img, i) => ({ key: flightKey++, side, charIndex, img, delay: i * 170 }));
    setVfxList((prev) => [...prev, ...spawned]);
    window.setTimeout(() => {
      setVfxList((prev) => prev.filter((v) => !spawned.includes(v)));
    }, 1100 + imgs.length * 170);
  }

  // ナレーションイベントに合わせて「カードが飛ぶ」物理演出
  useEffect(() => {
    if (!current) return;
    const s = (current.side ?? PLAYER) as 0 | 1;
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
      case 'mill':
        spawnFlight(deckRefs[s].current, trashRefs[s].current, current.amount ?? 1);
        break;
      case 'play':
      case 'guard':
        // このスキルの属性を記憶（後続のダメージ等のVFXに使う）
        if (current.card?.type === 'skill') {
          lastAttrsRef.current = [...new Set(current.card.conditionAttribute)];
        } else {
          lastAttrsRef.current = [];
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
        break;
      case 'lock':
        spawnVfx(current.side, current.charIndex, [...lastAttrsRef.current.map((a) => `vfx_${a}`), 'vfx_lock']);
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

  /** プレビュー中のカードを使う（必要なら対象選択モードへ） */
  function playFromPreview(handIndex: number) {
    const card = cardById(me.hand[handIndex]);
    setPreviewHand(null);
    if (card.type === 'skill') {
      const eff = skillEffectOf(card.id);
      if (eff?.anyCharacterCanUse) {
        const eligible = myActions.filter(
          (a) => a.type === 'playSkill' && a.handIndex === handIndex && a.usingIndex !== undefined,
        );
        if (eligible.length > 1) return setTargeting({ kind: 'allyUse', handIndex });
        if (eligible.length === 1) return act(eligible[0]);
      }
      if (card.valueType === 'heal') return setTargeting({ kind: 'allyHeal', handIndex });
      if (card.valueType === 'attack' && eff?.targeting === 'choose') {
        return setTargeting({ kind: 'enemy', handIndex });
      }
      act({ type: 'playSkill', handIndex });
    } else if (card.type === 'character') {
      act({ type: 'playCharacter', handIndex });
    } else if (card.type === 'equipment') {
      setTargeting({ kind: 'allyEquip', handIndex });
    } else if (card.type === 'field') {
      act({ type: 'playField', handIndex });
    }
  }

  function tapChar(side: 0 | 1, index: number) {
    if (!targeting) return;
    if (targeting.kind === 'enemy' && side === ENEMY && isCharAlive(state, ENEMY, index)) {
      act({ type: 'playSkill', handIndex: targeting.handIndex, targetIndex: index });
    }
    if (targeting.kind === 'allyHeal' && side === PLAYER && isCharAlive(state, PLAYER, index)) {
      act({ type: 'playSkill', handIndex: targeting.handIndex, healTargetIndex: index });
    }
    if (targeting.kind === 'allyEquip' && side === PLAYER && isCharAlive(state, PLAYER, index)) {
      act({ type: 'playEquipment', handIndex: targeting.handIndex, targetIndex: index });
    }
    if (targeting.kind === 'allyUse' && side === PLAYER) {
      const match = myActions.find(
        (a) => a.type === 'playSkill' && a.handIndex === targeting.handIndex && a.usingIndex === index,
      );
      if (match) act(match);
    }
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
    <div className={`battle-root ${finished ? '' : isMyTurn ? 'my-turn' : 'enemy-turn'}`}>
      {/* ターンバッジ（常時表示） */}
      {!finished && (
        <div className={`turn-badge ${isMyTurn ? 'mine' : 'theirs'}`}>
          {isMyTurn ? 'あなたのターン' : '相手のターン'}
        </div>
      )}
      {/* 相手情報バー（表層UI） */}
      <div className="info-bar">
        <span className="deck-name">{setup.enemy.name}</span>
        <span className="turn-label">ターン{state.turn}・{isMyTurn ? 'あなた' : '相手'}</span>
        <button className="chip small" onClick={() => setShowRules(true)}>？ルール</button>
        <button className="chip small" onClick={() => setConfirmExit(true)}>投了</button>
      </div>

      {/* 盤面（3Dに傾くテーブル） */}
      <div className="board-wrap">
        <div className="board" ref={boardRef}>
          {/* 相手の手札（裏向きの扇） */}
          <div className="enemy-hand" ref={handRefE}>
            {foe.hand.map((_, i) => (
              <img key={i} src={IMG('back')} className="hand-back" style={{ marginLeft: i === 0 ? 0 : -22 }} />
            ))}
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
              onZoom={setZoomCard}
            />
          </div>

          {/* 中央: フィールド + ガイドテキスト（薄い帯） */}
          <div className="center-strip">
            <div className="field-slot">
              {fieldCard ? <CardFrame card={fieldCard} width={40} /> : <div className="field-empty">FIELD</div>}
            </div>
            <GuideTicker text={guideText(state.phase, isMyTurn, busy, targeting !== null, guardPhase)} />
          </div>

          {/* 自分エリア: 左に陣形、右にゾーン（山札が一番右） */}
          <div className="area my-area">
            <Formation
              side={PLAYER} state={view} pops={pops} targeting={targeting}
              onTap={tapChar} koShown={koShown} cardW={cardW} vfxList={vfxList}
              onZoom={setZoomCard}
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

      {/* 自分の手札（手に持っているので傾けない） */}
      <div className="my-hand" ref={handRefP}>
        {me.hand.map((id, i) => {
          const card = cardById(id);
          const playable = isMyTurn && state.phase === 'play' && handPlayable.has(i);
          const chargeable = isMyTurn && state.phase === 'charge' && !busy;
          const picked = chargeSel.has(i);
          return (
            <div
              key={`${id}-${i}`}
              className={[
                'hand-card',
                picked ? 'raised' : '',
                playable || chargeable ? 'playable' : '',
              ].join(' ')}
              style={{ marginLeft: i === 0 ? 0 : -Math.round(handW * 0.37), zIndex: i }}
              onClick={() => tapHand(i)}
              {...longPressHandlers(() => setZoomCard(id))}
            >
              <CardFrame card={card} width={handW} upright />
              {picked && <span className="pick-badge">⚡</span>}
            </div>
          );
        })}
      </div>

      {/* アクションバー */}
      <div className="action-bar">
        {busy ? (
          <span className="hint">…</span>
        ) : targeting ? (
          <>
            <span className="hint">
              {targeting.kind === 'enemy'
                ? '攻撃する相手を選んでください'
                : targeting.kind === 'allyUse'
                  ? 'このスキルを使うキャラを選んでください'
                  : '対象の味方を選んでください'}
            </span>
            <button className="chip" onClick={() => setTargeting(null)}>やめる</button>
          </>
        ) : guardPhase ? (
          <span className="hint danger">相手の攻撃！ ガードで割り込めます</span>
        ) : !isMyTurn || finished ? (
          <span className="hint">{finished ? 'バトル終了' : '相手のターン…'}</span>
        ) : state.phase === 'play' ? (
          <button className="chip" onClick={() => act({ type: 'endPlay' })}>チャージへ →</button>
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

      {/* ナレーション */}
      {current && <NarrationBanner ev={current} />}
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
function Formation({ side, state, pops, targeting, onTap, koShown, cardW, vfxList, onZoom }: {
  side: 0 | 1;
  state: BattleState;
  pops: DamagePop[];
  targeting: Targeting;
  onTap: (side: 0 | 1, index: number) => void;
  koShown: Set<string>;
  cardW: number;
  vfxList: { key: number; side: 0 | 1; charIndex: number; img: string; delay: number }[];
  onZoom?: (cardId: string) => void;
}) {
  const p = state.players[side];
  const n = p.characters.length;
  const step = 360 / Math.max(n, 1);
  const r = Math.round(cardW * 0.92); // ホイール半径
  const frontW = Math.round(cardW * 1.08);
  const backScale = 0.74;

  // 前面 = 中央（相手側）寄り。自分は上向き、相手は下向き
  const frontAngle = side === PLAYER ? 0 : 180;
  const tilt = n === 2 ? 28 : 0; // 2人の時は斜めに
  const desired = frontAngle - p.actorIndex * step + tilt;

  // 回転は最短経路で連続的に（リボルバーの回転演出）
  const rotRef = useRef(desired);
  const prev = rotRef.current;
  const delta = ((desired - prev) % 360 + 540) % 360 - 180;
  const wheelRot = prev + delta;
  useEffect(() => {
    rotRef.current = wheelRot;
  });

  const width = Math.round(r * 1.8 + cardW * 0.9);
  const height = Math.round(r * 1.55 + cardW * 1.39 * 0.85);
  const selectable =
    (targeting?.kind === 'enemy' && side === ENEMY) ||
    ((targeting?.kind === 'allyHeal' || targeting?.kind === 'allyEquip') && side === PLAYER);

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
        const A = i * step + wheelRot;
        const scale = isActor ? 1 : backScale;
        return (
          <div
            key={c.cardId + i}
            className={[
              'char-slot',
              'wheel-slot',
              isActor ? 'actor' : '',
              koVisible ? 'ko' : '',
              selectable && alive ? 'selectable' : '',
            ].join(' ')}
            style={{
              left: '50%',
              top: '50%',
              zIndex: isActor ? 6 : 3,
              transform: `translate(-50%, -50%) rotate(${A}deg) translateY(${-r}px) rotate(${-A}deg) scale(${scale})`,
            }}
            onClick={() => onTap(side, i)}
            {...longPressHandlers(() => onZoom?.(c.cardId))}
          >
            <div className={myPops.some((d) => d.amount > 0) ? 'card-hit' : ''}>
              <CardFrame card={cardById(c.cardId)} width={frontW} />
            </div>
            {koVisible && <img src={IMG('back')} className="ko-back" />}
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
                  {extras.length > 0 && (
                    <span className="extra-attrs">
                      {extras.slice(0, 4).map((a, k) => (
                        <img key={k} src={IMG(a)} alt={a} title={`追加属性: ${a}`} />
                      ))}
                    </span>
                  )}
                </div>
              </div>
            )}
            {myVfx.map((v) => (
              <img
                key={v.key}
                className="vfx-burst"
                src={IMG(v.img)}
                style={{ animationDelay: `${v.delay}ms`, transform: `rotate(${(v.key * 47) % 40 - 20}deg)` }}
                onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
              />
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
      <span className="pile-count">{p.deck.length}</span>
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
    <div className="fly-ghost" style={{ left: pos.x, top: pos.y }}>
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

const KIND_ICON: Record<string, string> = {
  turn: '🔄', draw: '🃏', charge: '⚡', chargeDeck: '⚡', mill: '🗑️', play: '✨',
  guard: '🛡️', attack: '⚔️', damage: '💥', heal: '💚', ko: '💀', revive: '🌟',
  actor: '👉', ability: '⚡', equip: '🛡️', field: '🌍', attr: '➕', search: '🔍',
  lock: '🔒', end: '🏁', info: '💬',
};

function NarrationBanner({ ev }: { ev: NarrEvent }) {
  return (
    <div key={ev.key} className={`narration kind-${ev.kind}`}>
      <span className="narr-icon">{KIND_ICON[ev.kind] ?? '💬'}</span>
      <span className="narr-text">{ev.text}</span>
    </div>
  );
}

/** 1行の電光掲示板。はみ出す場合は流れる */
function GuideTicker({ text }: { text: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const spanRef = useRef<HTMLSpanElement>(null);
  const [scroll, setScroll] = useState(false);
  useEffect(() => {
    const box = boxRef.current;
    const span = spanRef.current;
    if (!box || !span) return;
    setScroll(span.scrollWidth > box.clientWidth + 4);
  }, [text]);
  return (
    <div className="guide-zone ticker" ref={boxRef}>
      <span ref={spanRef} className={scroll ? 'ticker-run' : ''}>{text}</span>
    </div>
  );
}

function guideText(phase: string, isMyTurn: boolean, busy: boolean, targeting: boolean, guardPhase: boolean): string {
  if (busy) return '⏳ 何が起きているか、上のナレーションを見てね';
  if (phase === 'choice') return '🌀 ターン開始の能力を使うか選ぼう';
  if (guardPhase) return '🛡️ 相手の攻撃！ガードカードで割り込むか、そのまま受けるか選ぼう';
  if (targeting) return '🎯 対象のキャラクターをタップしよう';
  if (!isMyTurn) return '⏳ 相手のターン。ようすを見よう';
  if (phase === 'play') return '✨ 明るい手札＝今使えるカード。タップして「使う」！終わったら「チャージへ」';
  if (phase === 'charge') return '⚡ チャージしたいカードを複数えらんで「チャージ」。よければ「ターンエンド」';
  return '';
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
      <div className="dialog result">
        <h2 className={won ? 'win' : 'lose'}>{won ? 'WIN!' : 'LOSE...'}</h2>
        <p>{reason}で{won ? '勝利' : '敗北'}（ターン{state.turn}）</p>
        <a className="big-btn slim share" href={shareUrl} target="_blank" rel="noreferrer">
          Xで結果をシェア
        </a>
        <div className="dialog-btns">
          <button className="chip" onClick={onExit}>ホームへ</button>
          <button className="big-btn slim" onClick={onRematch}>もう一回</button>
        </div>
      </div>
    </div>
  );
}
