import {
  cardById,
  effectiveAttributes,
  eligibleUsingChars,
  isCharAlive,
  maxHpOf,
  predictSkill,
  skillEffectOf,
  type BattleAction,
  type BattleState,
  type CharacterCard,
  type SkillCard,
} from '@bravers/engine';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BattleSetup } from '../App';
import { CardFrame } from '../CardFrame';
import { IMG } from '../cardAssets';
import type { NarrEvent } from '../battle/narrator';
import { ALL_SFX, isSfxEnabled, playSfx, preloadSfx, setSfxEnabled } from '../battle/sfx';
import {
  Formation,
  NarrationBanner,
  StatusBadges,
  TurnSplash,
  ZoneCol,
  longPressHandlers,
  type Targeting,
} from '../battle/BoardParts';
import { CardStage, type CardMove, type Spot } from '../battle/CardStage';
import { useBattle } from '../battle/useBattle';
import { logEvent } from '../telemetry';
import { encodeSharedLog, type SharedLog } from '../shareLog';

/** シェアリンクの飛び先（公開ページ） */
const SITE_URL = 'https://raccbigenner.github.io/bravers_duel/';
import { RulesModal } from './RulesModal';
import '../battle.css';

const PLAYER = 0 as const;
const ENEMY = 1 as const;

/**
 * 画面の大きさ（リサイズ追従）。
 *
 * 高さだけを見ていた頃は、横幅だけが変わったとき（PCで窓を横に伸ばす等）に
 * setVh が同じ値になって React が再描画を打ち切り、盤面が古い横幅のままになっていた。
 * 盤面の寸法は縦と横の両方から決まるので、両方を状態として持つ。
 */
function useViewportSize(): { vw: number; vh: number } {
  const [size, setSize] = useState(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
  useEffect(() => {
    // リサイズは間引く（頻繁なレイアウト変更で画面がガタつくのを防ぐ）
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () =>
          setSize((prev) =>
            prev.vw === window.innerWidth && prev.vh === window.innerHeight
              ? prev
              : { vw: window.innerWidth, vh: window.innerHeight },
          ),
        180,
      );
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return size;
}

/**
 * 盤面が入りきらない画面かどうか。
 *
 * 効くのは**高さだけ**。横幅は battle-root が 440px で頭打ちになるので、
 * どれだけ横に広くても盤面の収まりには関係しない。
 * 以前は「横向き かつ 高さ520px未満」で判定していたが、これには2つ誤りがあった。
 *   - 横向きかどうかは無関係（縦長で高さ400pxの画面でも同じように入らない）
 *   - 520px は盤面を作り直す前の数字。今は 480px でも普通に入るのに止めていた
 *     （実測: 1280x480 でカード幅47px・重なり0・帯への食い込み0）
 *
 * 下限（MIN_BOARD_HEIGHT）は boardMetrics のすぐ下で、寸法の式から逆算している。
 * カード幅が下限の44pxに張り付くと、そこから先は画面が縮んでも盤面が縮まないので
 * はみ出しが始まる。その境目が下限。
 */
function isTouchDevice(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? navigator.maxTouchPoints > 0;
}

function useNeedsPortrait(): boolean {
  const check = () => window.innerHeight < MIN_BOARD_HEIGHT;
  const [needs, setNeeds] = useState(check);
  useEffect(() => {
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setNeeds(check()), 180);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return needs;
}

/**
 * 盤面まわりの寸法を、画面の高さから逆算する。
 *
 * 以前の `budget = 0.3 × 画面高 + 9` は当て推量で、実際に盤面に使える縦
 * （実測 582px @390x844）を 100px 以上少なく見積もっていた。その差が
 * 「自分の陣形の下の 63px の死に余白」としてそのまま捨てられていた。
 *
 * ここでは画面の高さから「盤面の外にある物」を実測値で引き、
 * 残りを「相手の手札 + 陣形2つ + 中央の情報帯」で割り付ける。
 *
 * ★ここの数字を触ったら、必ず13サイズの検査を回すこと
 *   （死に余白20px以下 / カードの重なり0 / アクターの隙間15px以上 / 山の見え幅24〜40px）。
 */
/** 陣形2つぶんの縦。カード幅の何倍か（3Dの遠近ぶんを含む実測値） */
const FORMATION_SPAN = 4.33;
/** 手札の箱の高さ = カード幅 × 0.74（手札の幅）× 1.58（箱の高さ） */
const HAND_RATIO = 0.74 * 1.58;
/** .board の上下パディング（下が厚いのは、3Dの遠近で下端のカードが箱より下へ描かれるため） */
const BOARD_PAD = 14;
/** 中央の情報帯の高さ。ここには絶対に何も重ならない領域として確保する */
const STRIP_H = 70;
/**
 * 情報帯の外に、さらに残すすき間の予算。
 * .board は justify-content: space-between なので、余った縦は要素間のすき間になる。
 * 敵味方を引き離す仕事は情報帯（STRIP_H）が持つので、ここは「帯にめり込ませない」ための
 * 上乗せぶんだけでよい。予算がゼロだと、カードを大きくした瞬間にアクターが帯へ食い込む。
 */
const ACTOR_GAP_BUDGET = 30;
/** カード幅の下限。これ以下には縮めない（縮めても読めない） */
const MIN_CARD_W = 44;
/**
 * 盤面が入りきる画面の高さの下限。
 * カード幅が下限に張り付くと、そこから先は画面が縮んでも盤面が縮まないので
 * はみ出しが始まる。その境目を式から逆算する（今の値は約 461px）。
 * 低い画面用の @media が効く前提なので、chrome は短い方（79 / 26）で見積もる。
 */
const MIN_BOARD_HEIGHT = Math.ceil(
  MIN_CARD_W * (FORMATION_SPAN + HAND_RATIO) + 79 + 26 + BOARD_PAD + STRIP_H + ACTOR_GAP_BUDGET,
);
/** 山札・AP・トラッシュが画面の内側に見えている幅。残りは画面外へはみ出す */
const ZONE_VISIBLE = 28;
/**
 * 手前（自分側）は3Dの遠近で実際より大きく描かれる倍率。
 * 陣形の横幅を「3.2 × カード幅」で見積もると、手前側だけこのぶん外へはみ出して
 * 端のパイル（山札・AP・トラッシュ）に食い込む（実測 390x844 で 13px）。
 */
const NEAR_MAGNIFY = 1.06;

interface BoardMetrics {
  /** キャラカードの基準幅 */
  cardW: number;
  /** 手札1枚の幅 */
  handW: number;
  /** 山札・AP・トラッシュ1つぶんの幅 */
  pileW: number;
  /** ゾーン列の縦のすき間 */
  pileGap: number;
}

function boardMetrics(vh: number, vw: number): BoardMetrics {
  // 低い画面では battle.css の @media (max-height: 780px) が余白とバーを詰めるので、
  // 引く量もそれに合わせる（ここがズレると狭い端末だけ盤面が画面からはみ出す）
  const short = vh <= 780;
  const chrome = short ? 79 : 97; // 余白 + すき間 + 情報バー + アクションバー
  const enemyHand = short ? 26 : 38; // 相手の裏向き手札の帯
  const byHeight =
    (vh - chrome - enemyHand - BOARD_PAD - STRIP_H - ACTOR_GAP_BUDGET) / (FORMATION_SPAN + HAND_RATIO);
  // 横は「陣形の全幅（3.2×カード幅）＋左右のゾーンの見えている幅」が画面に収まること。
  // 手前側は遠近で大きく描かれるので、その倍率で割ってからでないとパイルに食い込む。
  const byWidth = (Math.min(vw, 440) - ZONE_VISIBLE * 2) / (3.2 * NEAR_MAGNIFY);
  const cardW = Math.max(MIN_CARD_W, Math.floor(Math.min(byHeight, byWidth)));

  // ゾーン列は「片側の陣形と同じ高さ」に収める。ここを超えると相手側の半分へ食い込み、
  // さらに（絶対配置にする前は）エリアの高さを押し広げて死に余白を作っていた。
  const pileGap = Math.max(6, Math.round(cardW * 0.1));
  const half = (FORMATION_SPAN / 2) * cardW;
  const pileW = Math.max(28, Math.min(Math.round(cardW * 0.56), Math.floor((half - pileGap * 2) / 3 / 1.4)));

  return { cardW, handW: Math.round(cardW * 0.74), pileW, pileGap };
}


let flightKey = 1;
let fieldBackKey = 1;

/**
 * フィールドカードの絵を、卓（バトルマップ）の上に薄く重ねる。
 *
 * 卓そのものは消さずに残し、その土地の色に染める。差し替わったら前の絵とクロスフェードする。
 * 濃く出すと絵が2枚けんかして、盤面のカードも沈むので、あくまで「薄く」。
 * 動きはゆっくりした流れ（drift）と、斜めに通り抜ける光（sheen）の2つだけ。
 */
function FieldBackdrop({ cardId }: { cardId: string | null }) {
  const [layers, setLayers] = useState<{ key: number; id: string | null }[]>([]);
  useEffect(() => {
    const key = fieldBackKey++;
    // 直前の1枚だけ残す。古いほうが 'out' になって消えていく
    setLayers((prev) => [...prev.slice(-1), { key, id: cardId }]);
    const timer = window.setTimeout(() => setLayers((prev) => prev.filter((l) => l.key === key)), 1800);
    return () => window.clearTimeout(timer);
  }, [cardId]);

  return (
    <>
      {layers.map((l, i) =>
        l.id ? (
          <div
            key={l.key}
            className={`field-back ${i === layers.length - 1 ? 'in' : 'out'}`}
            style={{ backgroundImage: `url(${IMG(l.id)})` }}
          />
        ) : null,
      )}
      {cardId && <div className="field-sheen" />}
    </>
  );
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
  const [previewGuard, setPreviewGuard] = useState<number | null>(null); // ガードカードの使用前確認
  const [zoomCard, setZoomCard] = useState<string | null>(null); // 読み取り専用の拡大表示（カードID）
  const [pileList, setPileList] = useState<{ title: string; cards: string[]; grouped?: boolean; note?: string } | null>(null);
  const [chargeSel, setChargeSel] = useState<Set<number>>(new Set());
  const [targeting, setTargeting] = useState<Targeting>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [moves, setMoves] = useState<CardMove[]>([]);
  const [sfxOn, setSfxOn] = useState(isSfxEnabled());

  // 公開βのログ: バトル開始を1回だけ記録
  useEffect(() => {
    logEvent('battle_start', {
      playerDeck: setup.playerDeckName,
      playerDeckKind: setup.playerDeckKind,
      enemyDeck: setup.enemy.name,
      enemyRandom: setup.enemyRandom,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { vw, vh } = useViewportSize();
  const needsPortrait = useNeedsPortrait();
  // 手札の幅は cardW × 0.74（2026-07-25 βレビュー対応）。
  // 手札の箱が高いと、その上にある自分のアクターのHP・属性表示に手札がかぶる。
  const { cardW, handW, pileW, pileGap } = boardMetrics(vh, vw);

  /**
   * 山札・AP・トラッシュのはみ出し量を「実際に描かれた位置」から1枚ずつ決める。
   *
   * 盤は rotateX で奥へ倒れているので、
   * - 上（相手側）ほど横が狭く見える（実測 390x844: 相手エリア 351px / 自分エリア 384px）
   * - 同じ列の中でも、上のパイルと下のパイルで奥行きが違う（内側の端が 7px ばらついた）
   * - APは横倒し（rotate 90deg）なので見た目の幅がそもそも別物
   *
   * 式で一律に決めると必ずどれかが食い違うので、描画後に1枚ずつ測って差を打ち消す。
   * ずれ量とマージンは線形なので、1回の補正でぴったり合う。
   */
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const rr = root.getBoundingClientRect();
    root.querySelectorAll<HTMLElement>('.zone-col').forEach((col) => {
      const enemy = col.classList.contains('enemy');
      const area = col.parentElement;
      if (!area) return;
      // 盤の3Dで伸び縮みしているぶん。盤の中で1px動かすと画面では scale px 動く
      const scale = area.getBoundingClientRect().width / area.offsetWidth;
      if (!scale) return;
      col.querySelectorAll<HTMLElement>('.pile').forEach((pile) => {
        const card = pile.querySelector<HTMLElement>('.pile-card');
        if (!card) return;
        const cr = card.getBoundingClientRect();
        const visible = enemy ? cr.right - rr.left : rr.right - cr.left;
        const current = parseFloat(getComputedStyle(pile).marginLeft) || 0;
        // マージンを増やすとパイルは右へ動く。
        // 相手（左端）は右へ動くと見え幅が増え、自分（右端）は右へ動くと見え幅が減る。
        // 符号を分けないと自分側だけ発散する（実際に margin が倍々に増えて画面外へ飛んだ）。
        const delta = (ZONE_VISIBLE - visible) / scale;
        pile.style.marginLeft = `${Math.round((current + (enemy ? delta : -delta)) * 10) / 10}px`;
      });
    });
  }, [vw, vh, cardW, pileW]);
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

  /** 要素の「今いる場所」。パイルは箱ではなく中のカードの位置を使う */
  function spotOf(el: HTMLElement | null, w?: number): Spot | null {
    if (!el) return null;
    const target = el.querySelector<HTMLElement>('.pile-card') ?? el;
    const r = target.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: w ?? r.width };
  }

  /** 各ゾーンの位置。カードはここからここへ動く */
  const spot = {
    deck: (s: 0 | 1) => spotOf(deckRefs[s].current, pileW),
    ap: (s: 0 | 1) => spotOf(apRefs[s].current, pileW),
    trash: (s: 0 | 1) => spotOf(trashRefs[s].current, pileW),
    hand: (s: 0 | 1) => spotOf(handRefs[s].current, s === PLAYER ? handW : pileW),
    // 盤の中央（使ったカードを見せる場所）
    center: (): Spot | null => {
      const b = boardRef.current?.getBoundingClientRect();
      if (!b) return null;
      return { x: b.left + b.width / 2, y: b.top + b.height * 0.44, w: Math.min(220, Math.round(vw * 0.54)) };
    },
    /** 盤面の任意の要素（フィールド枠・キャラの枠など） */
    el: (selector: string): Spot | null =>
      spotOf(rootRef.current?.querySelector<HTMLElement>(selector) ?? null),
  };

  /**
   * カードを1枚動かす。これが物理演出の唯一の入口。
   * count が複数のときは少しずつ時間をずらして、束で流れるように見せる。
   */
  function flyCard(
    m: Omit<CardMove, 'key' | 'from' | 'to' | 'via'> & {
      from: Spot | null;
      to: Spot | null;
      via?: Spot | null;
      count?: number;
      cardIds?: (string | undefined)[];
    },
  ) {
    const { from, to, via, count = 1, cardIds, ...rest } = m;
    if (!from || !to) return;
    // 途中で見せる場所が取れなければ直行に落とす（演出が止まるより出したほうがよい）
    if (via) (rest as CardMove).via = via;
    playSfx('se_card', 0.3); // カードが擦れて滑る音
    for (let i = 0; i < Math.min(count, 3); i++) {
      const move: CardMove = { ...rest, key: flightKey++, from, to, cardId: cardIds?.[i] ?? rest.cardId };
      const delay = i * 130;
      window.setTimeout(() => setMoves((prev) => [...prev, move]), delay);
      // 保険: アニメーションの完了イベントは、タブが裏に回っている間は来ない。
      // それだけを頼りにすると、戻ってきたときに飛びかけのカードが画面に残り続ける。
      window.setTimeout(() => setMoves((prev) => prev.filter((x) => x.key !== move.key)), delay + move.duration + 500);
    }
  }

  /** 山札→手札などの「そのまま滑らせる」移動のひな型 */
  function slide(from: Spot | null, to: Spot | null, opts: Partial<CardMove> & { count?: number; cardIds?: (string | undefined)[] } = {}) {
    flyCard({
      from,
      to,
      arc: 26,
      duration: 620,
      faceFrom: 'back',
      faceTo: 'back',
      poseFrom: 'lay',
      poseTo: 'lay',
      ...opts,
    });
  }

  // スキルの属性を覚えておき、続くダメージ等のVFXに使う
  const lastAttrsRef = useRef<string[]>([]);
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

  // キャラカード自体の短いモーション（攻撃の踏み込みなど）
  interface Motion { key: number; side: 0 | 1; charIndex: number; cls: string }
  const [motions, setMotions] = useState<Motion[]>([]);

  function spawnMotion(side: 0 | 1 | undefined, charIndex: number | undefined, cls: string, life = 520) {
    if (side === undefined || charIndex === undefined) return;
    const m: Motion = { key: flightKey++, side, charIndex, cls };
    setMotions((prev) => [...prev, m]);
    window.setTimeout(() => setMotions((prev) => prev.filter((x) => x.key !== m.key)), life);
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

  // ---------- カメラワーク ----------
  // 対象選択中は該当サイドへ寄って角度を浅くする。演出中は使用者→対象へ軽くフォーカス。
  // ポーズは3種類だけ（デフォルト/味方寄り/敵寄り）にして、ぐりぐり動かしすぎない
  const [camTemp, setCamTemp] = useState<'cam-ally' | 'cam-enemy' | null>(null);
  const camTimer = useRef<number | null>(null);
  function focusCam(side: 0 | 1 | undefined, life = 1200) {
    if (side === undefined) return;
    setCamTemp(side === PLAYER ? 'cam-ally' : 'cam-enemy');
    if (camTimer.current) window.clearTimeout(camTimer.current);
    camTimer.current = window.setTimeout(() => setCamTemp(null), life);
  }
  const camClass = targeting ? (targeting.side === PLAYER ? 'cam-ally' : 'cam-enemy') : (camTemp ?? '');

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
      apTrash: ['se_break', 0.5],
      handTrash: ['se_break', 0.45],
      trashToDeck: ['se_card', 0.35],
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
      // バトル開始(coin)と決着(end)は音なし（社長判断）
    };
    const se = SFX_BY_KIND[current.kind];
    if (se) playSfx(se[0], se[1]);
    switch (current.kind) {
      // ---- カードの移動（どれも「同じ1枚が動く」） ----
      case 'draw': {
        const n = current.amount ?? 1;
        // 自分が引いた札は、着地の瞬間に表へ翻る（引いた実感が出る）。
        // 相手の札は裏のまま（見せてはいけない情報）。
        const drawn = s === PLAYER ? me.hand.slice(-n) : [];
        slide(spot.deck(s), spot.hand(s), {
          count: n,
          cardIds: drawn,
          faceTo: s === PLAYER ? 'front' : 'back',
          poseTo: 'stand', // 卓に寝ていた札が、手札で自分に正対して立つ
          arc: 34,
          duration: 700,
        });
        break;
      }
      case 'charge':
      case 'chargeAll':
        // 手札の札を横倒しにしてAPへ重ねる
        slide(spot.hand(s), spot.ap(s), {
          count: current.kind === 'chargeAll' ? (current.amount ?? 1) : 1,
          faceFrom: 'front',
          poseFrom: 'stand',
          spin: true,
          duration: 600,
        });
        break;
      case 'chargeDeck':
        slide(spot.deck(s), spot.ap(s), { count: current.amount ?? 1, spin: true });
        break;
      case 'chargeTrash':
        slide(spot.trash(s), spot.ap(s), { count: current.amount ?? 1, faceFrom: 'front', spin: true });
        break;
      case 'mill':
        // デッキから落ちる札は、表に翻ってからトラッシュへ（何が落ちたか見える）
        slide(spot.deck(s), spot.trash(s), { count: current.amount ?? 1, faceTo: 'front' });
        break;
      case 'apTrash':
        slide(spot.ap(s), spot.trash(s), { count: current.amount ?? 1, faceTo: 'front' });
        break;
      case 'handTrash':
        slide(spot.hand(s), spot.trash(s), {
          count: current.amount ?? 1,
          faceFrom: 'front',
          faceTo: 'front',
          poseFrom: 'stand',
        });
        break;
      case 'trashToDeck':
        slide(spot.trash(s), spot.deck(s), { count: current.amount ?? 1, faceFrom: 'front' });
        break;
      case 'attack':
        // 攻撃者が前（中央側）へ踏み込む
        spawnMotion(current.side, current.charIndex, 'lunge');
        focusCam(current.side, 900);
        break;
      case 'play':
      case 'guard': {
        // 詠唱エフェクトは「今まさに使われたカード」の属性（回復・補助もこれで正しい）
        const castAttrs = current.card?.type === 'skill' ? [...new Set(current.card.conditionAttribute)] : [];
        lastAttrsRef.current = castAttrs; // 回復の演出だけ、直前のカードを引き継ぐ
        // スキル使用: 使用者側へカメラを寄せる
        focusCam(current.side, 1100);
        // 使用キャラに「詠唱」エフェクト（属性の光 + 立ち上る詠唱リング）
        // ガードはガード専用の盾VFX
        if (current.charIndex !== undefined && current.side !== undefined) {
          spawnVfx(
            current.side,
            current.charIndex,
            current.kind === 'guard'
              ? ['vfx_guard', 'css:pguard']
              : ['css:cast', ...castAttrs.slice(0, 2).map((a) => `vfx_${a}`)],
          );
        }
        // ガードは「いくつ → いくつ」を頭上に大きく出す
        if (current.kind === 'guard' && current.amountBefore !== undefined) {
          spawnPlate(current.side, current.charIndex, `${current.amountBefore} → ${current.amount}`, 'guard', 1900, 'icon_shield');
        }
        // 使ったカードは「手札から浮いて → 盤の中央で見せて → トラッシュへ滑る」の一続き。
        // 以前はここが3つの別物（消える手札／中央のreveal／小さいゴースト）に分かれていた。
        flyCard({
          cardId: current.card?.id,
          // ドラッグで置いたときは、指を離した場所から続けて飛ぶ（手札へ戻ってから飛び直さない）
          from: (s === PLAYER && playOriginRef.current) || spot.hand(s),
          via: spot.center(),
          to: spot.trash(s),
          hold: Math.max(300, current.duration - 900),
          faceFrom: 'front',
          faceTo: 'front',
          poseFrom: 'stand',
          poseTo: 'lay',
          duration: Math.max(700, current.duration - 260),
        });
        playOriginRef.current = null;
        break;
      }
      case 'field':
        // フィールドは情報帯の枠へ置かれて、そのまま残る
        flyCard({
          cardId: current.card?.id,
          from: spot.hand(s),
          via: spot.center(),
          to: spot.el('.strip-field'),
          hold: Math.max(300, current.duration - 900),
          faceFrom: 'front',
          faceTo: 'front',
          poseFrom: 'stand',
          poseTo: 'lay',
          duration: Math.max(700, current.duration - 260),
        });
        break;
      case 'equip':
        // 装備は対象キャラの足元へ滑り込む
        if (current.card && current.charIndex !== undefined && current.side !== undefined) {
          flyCard({
            cardId: current.card.id,
            from: spot.hand(s),
            via: spot.center(),
            to: spot.el(`[data-slot="${current.side}-${current.charIndex}"]`),
            hold: Math.max(300, current.duration - 900),
            faceFrom: 'front',
            faceTo: 'front',
            poseFrom: 'stand',
            poseTo: 'lay',
            duration: Math.max(700, current.duration - 260),
          });
        }
        break;
      case 'turn':
        lastAttrsRef.current = [];
        break;
      case 'damage':
        // 属性はエンジンが伝えた「ダメージを生んだスキル」から取る。
        // 直前に使われたカードを覚える方式だと、ガードで割り込まれた瞬間に
        // ガードカードの属性に化けていた（例: 斬の攻撃が突のエフェクトで出る）。
        spawnVfx(current.side, current.charIndex, [...(current.attrs ?? []).map((a) => `vfx_${a}`), 'vfx_damage']);
        focusCam(current.side, 1000); // 受けた側へ寄る（使用者→対象の順になる）
        break;
      case 'heal':
        spawnVfx(current.side, current.charIndex, [...lastAttrsRef.current.map((a) => `vfx_${a}`), 'vfx_heal']);
        focusCam(current.side, 1000);
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
          // テキストの裏は光らせない（社長判断）: プレートのみ表示
          spawnPlate(current.side, current.charIndex, current.text.replace(/！$/, ''), 'passive', 1700, 'icon_bolt');
        }
        break;
      }
      case 'power':
        spawnPlate(current.side, current.charIndex, `威力+${current.amount}`, 'power', 1400, 'icon_sword');
        break;
      case 'powerGuard':
        spawnPlate(current.side, current.charIndex, `ガード+${current.amount}`, 'pguard', 1400, 'icon_shield');
        break;
      case 'info':
        if (current.charName === '無傷') {
          spawnPlate(current.side, current.charIndex, '無傷！', 'miss', 1300);
        }
        break;
      case 'search':
        // 何を持ってきたかを中央で一度見せてから手札へ
        flyCard({
          from: spot.deck(s),
          via: spot.center(),
          to: spot.hand(s),
          hold: 420,
          faceFrom: 'back',
          faceTo: 'front',
          poseFrom: 'lay',
          poseTo: 'stand',
          duration: Math.max(700, current.duration - 200),
        });
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
    setPreviewGuard(null);
  }, [state.phase, isMyTurn]);

  // ============ 手札のジェスチャ（掴んで置く / 長押しで見る / タップ） ============
  //
  // これまでは「タップ → 全画面モーダル → 使う → 対象選択 → タップ」で3タップ＋モーダル1回。
  // 掴んで置けるようにして1ドラッグに縮める。
  // 動かさずに長押し＝拡大して見る、動かさず離す＝これまでどおりのタップ。
  const peekTimerRef = useRef(0);
  const gestureRef = useRef<{ x: number; y: number; i: number; moved: boolean; peeked: boolean } | null>(null);

  /** 掴んでいるカードの置き場所（合法手から導出する。UIで推測しない） */
  interface DropZone {
    key: string;
    rect: DOMRect;
    /** そのまま実行する行動 */
    action?: BattleAction;
    /** 落としたあとにさらに相手を選ぶ必要があるとき */
    follow?: NonNullable<Targeting>;
  }

  const [drag, setDrag] = useState<{
    handIndex: number;
    cardId: string;
    x: number;
    y: number;
    zones: DropZone[];
    over: string | null;
  } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  /** ドラッグで置いた場所。使用演出の出発点をそこに差し替える（指の位置から続けて飛ぶ） */
  const playOriginRef = useRef<Spot | null>(null);

  /**
   * カードの置き場所。
   *
   * **スキルは「使うキャラ」に置く。** 攻撃カードを相手に置く作りにしていたが、
   * スキルには必ず使用主体がいるので、光るのも落とすのも自分側のキャラが正しい
   * （社長指摘 2026-07-29）。使用主体はエンジンの eligibleUsingChars が唯一の正で、
   * 属性条件を満たすキャラだけが返る（ふつうはアクター、控えからも使えるスキルなら控えも）。
   *
   * 落としたあとにさらに選ぶ必要があるカード（攻撃相手を選ぶ／回復先を選ぶ）は、
   * follow を持たせて従来の対象選択モードへ渡す。
   */
  function dropZonesFor(handIndex: number): DropZone[] {
    const root = rootRef.current;
    const card = safeCard(me.hand[handIndex]);
    if (!root || !card) return [];
    const acts = myActions.filter((a) => 'handIndex' in a && a.handIndex === handIndex);
    if (acts.length === 0) return [];

    const zones: DropZone[] = [];
    const seen = new Set<string>();
    const rectOf = (sel: string) => root.querySelector<HTMLElement>(sel)?.getBoundingClientRect() ?? null;
    const pushChar = (side: 0 | 1, i: number, rest: Omit<DropZone, 'key' | 'rect'>) => {
      const key = `char:${side}-${i}`;
      if (seen.has(key)) return;
      const rect = rectOf(`[data-slot="${side}-${i}"]`);
      if (!rect) return;
      seen.add(key);
      zones.push({ key, rect, ...rest });
    };

    // 使うキャラがいないものは、ゾーンそのものが置き場所
    const chargeAct = acts.find((a) => a.type === 'charge');
    if (chargeAct) {
      const rect = rectOf('.zone-col:not(.enemy) .pile.ap');
      if (rect) zones.push({ key: 'ap', rect, action: chargeAct });
    }
    const fieldAct = acts.find((a) => a.type === 'playField');
    if (fieldAct) {
      const rect = rectOf('.strip-field');
      if (rect) zones.push({ key: 'field', rect, action: fieldAct });
    }

    // 装備は「装備するキャラ」、同名キャラ回復は「その同名キャラ」が置き場所
    for (const a of acts) {
      if (a.type === 'playEquipment') pushChar(PLAYER, a.targetIndex, { action: a });
    }
    const charAct = acts.find((a) => a.type === 'playCharacter');
    if (charAct && card.type === 'character') {
      me.characters.forEach((c, i) => {
        if (c.name === card.name && isCharAlive(view, PLAYER, i)) pushChar(PLAYER, i, { action: charAct });
      });
    }

    // スキルは「使うキャラ」が置き場所
    const skillActs = acts.filter((a) => a.type === 'playSkill');
    if (skillActs.length > 0 && card.type === 'skill') {
      const withUsing = skillActs.filter((a) => a.usingIndex !== undefined);
      if (withUsing.length > 0) {
        // 使うキャラを選べるスキル。その候補がそのまま置き場所になる
        for (const a of withUsing) pushChar(PLAYER, a.usingIndex!, { action: a });
      } else {
        const needTarget = skillActs.filter((a) => a.targetIndex !== undefined);
        const needHeal = skillActs.filter((a) => a.healTargetIndex !== undefined);
        let rest: Omit<DropZone, 'key' | 'rect'>;
        if (needTarget.length > 1) {
          rest = { follow: targetingFor(ENEMY, '攻撃する相手を選んでください', needTarget, 'targetIndex', card) };
        } else if (needHeal.length > 1) {
          rest = { follow: targetingFor(PLAYER, '回復する味方を選んでください', needHeal, 'healTargetIndex', card) };
        } else {
          rest = { action: skillActs[0] };
        }
        for (const ci of eligibleUsingChars(state, PLAYER, card)) pushChar(PLAYER, ci, rest);
      }
    }
    return zones;
  }

  /** 「対象を選ぶ」状態を組み立てる（予定の数字もここで付ける） */
  function targetingFor(
    side: 0 | 1,
    hint: string,
    acts: BattleAction[],
    field: 'targetIndex' | 'healTargetIndex',
    card: SkillCard,
  ): NonNullable<Targeting> {
    const actions = new Map<number, BattleAction>();
    for (const a of acts) {
      const i = (a as unknown as Record<string, number | undefined>)[field];
      if (i !== undefined) actions.set(i, a);
    }
    const p = predictSkill(state, PLAYER, card);
    return {
      side,
      hint,
      actions,
      preview: p ? { side, indexes: [...actions.keys()], kind: p.kind, value: p.value } : undefined,
    };
  }

  /** そのスキルが実際に効く相手（予定の数字を出す場所）。ドロップ先とは別 */
  function previewTargetsFor(card: SkillCard): { side: 0 | 1; indexes: number[] } | null {
    const aliveOf = (side: 0 | 1) =>
      view.players[side].characters.map((_, i) => i).filter((i) => isCharAlive(view, side, i));
    if (card.valueType === 'attack') {
      const t = skillEffectOf(card.id)?.targeting ?? 'actor';
      const indexes =
        t === 'all'
          ? aliveOf(ENEMY)
          : t === 'standby'
            ? aliveOf(ENEMY).filter((i) => i !== foe.actorIndex)
            : t === 'choose'
              ? aliveOf(ENEMY) // どれを狙うかは落としてから選ぶ
              : [foe.actorIndex];
      return { side: ENEMY, indexes };
    }
    if (card.valueType === 'heal') return { side: PLAYER, indexes: aliveOf(PLAYER) };
    return null;
  }

  function beginDrag(handIndex: number, x: number, y: number) {
    const cardId = me.hand[handIndex];
    if (!cardId) return;
    const zones = dropZonesFor(handIndex);
    if (zones.length === 0) return; // 置ける場所が無いカードは掴めない
    dragPosRef.current = { x, y };
    setDrag({ handIndex, cardId, x, y, zones, over: null });

    // 掴んでいる間、置ける場所（＝使用主体）を光らせる。
    // ただし「こうなる」の数字は実際に効く相手の上に出す（攻撃なら相手側）。
    const charZones = zones.filter((z) => z.key.startsWith('char:'));
    if (charZones.length === 0) return;
    const side = Number(charZones[0].key.slice(5, 6)) as 0 | 1;
    const actions = new Map<number, BattleAction>();
    for (const z of charZones) {
      const [sd, ci] = z.key.slice(5).split('-').map(Number);
      // 落とす場所を光らせるだけ。タップで発動させたいわけではないので action は入れない
      if (sd === side && z.action) actions.set(ci, z.action);
      else if (sd === side) actions.set(ci, { type: 'pass' });
    }
    const card = safeCard(cardId);
    let preview: NonNullable<Targeting>['preview'];
    if (card?.type === 'skill') {
      const p = predictSkill(state, PLAYER, card);
      const tgt = previewTargetsFor(card);
      if (p && tgt) preview = { side: tgt.side, indexes: tgt.indexes, kind: p.kind, value: p.value };
    }
    setTargeting({ side, hint: '', actions, preview });
  }

  function hitZone(zones: DropZone[], x: number, y: number): DropZone | null {
    return zones.find((z) => x >= z.rect.left && x <= z.rect.right && y >= z.rect.top && y <= z.rect.bottom) ?? null;
  }

  /**
   * 指の追従は state ではなく DOM を直接動かす。
   * 1フレームごとに setState すると、バトル画面まるごとが再描画されて指に付いてこない。
   * 状態として持つのは「どのゾーンの上にいるか」が変わった瞬間だけ。
   */
  const dragPosRef = useRef({ x: 0, y: 0 });
  const dragCardRef = useRef<HTMLDivElement>(null);
  function moveDrag(x: number, y: number) {
    dragPosRef.current = { x, y };
    if (dragCardRef.current) {
      dragCardRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -62%)`;
    }
    const d = dragRef.current;
    if (!d) return;
    const over = hitZone(d.zones, x, y)?.key ?? null;
    if (over !== d.over) setDrag({ ...d, over });
  }

  function endDrag(x: number, y: number) {
    const d = dragRef.current;
    setDrag(null);
    setTargeting(null);
    if (!d) return;
    const hit = hitZone(d.zones, x, y);
    if (!hit) {
      // 置けない場所で離したら手札へ戻す（何も起きない、を目に見える形で伝える）
      flyCard({
        cardId: d.cardId,
        from: { x, y, w: handW },
        to: spot.hand(PLAYER),
        faceFrom: 'front',
        faceTo: 'front',
        poseFrom: 'stand',
        poseTo: 'stand',
        arc: 10,
        duration: 240,
      });
      return;
    }
    playOriginRef.current = { x, y, w: handW };
    // 手札が減ると番号がずれるので、チャージの選択は白紙に戻す
    setChargeSel(new Set());
    if (hit.action) {
      act(hit.action);
      return;
    }
    // 使うキャラは決まったが、まだ相手を選ぶ必要があるカード
    if (hit.follow) setTargeting(hit.follow);
  }

  /** 手札1枚ぶんのジェスチャ。掴む／長押しで見る／タップ を1か所で捌く */
  function handGesture(i: number) {
    return {
      onPointerDown: (e: React.PointerEvent) => {
        if (finished || !isMyTurn || busy) return;
        try {
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        } catch {
          /* すでに解放済みのポインタなどは無視 */
        }
        gestureRef.current = { x: e.clientX, y: e.clientY, i, moved: false, peeked: false };
        window.clearTimeout(peekTimerRef.current);
        peekTimerRef.current = window.setTimeout(() => {
          const g = gestureRef.current;
          if (!g || g.moved) return;
          g.peeked = true;
          if (me.hand[g.i]) setZoomCard(me.hand[g.i]);
        }, 450);
      },
      onPointerMove: (e: React.PointerEvent) => {
        const g = gestureRef.current;
        if (!g) return;
        if (!g.moved) {
          // 指のぶれでドラッグが始まらないよう、少し動いてから掴んだ扱いにする
          if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 8) return;
          g.moved = true;
          window.clearTimeout(peekTimerRef.current);
          if (g.peeked) {
            g.peeked = false;
            setZoomCard(null);
          }
          beginDrag(g.i, e.clientX, e.clientY);
          return;
        }
        moveDrag(e.clientX, e.clientY);
      },
      onPointerUp: (e: React.PointerEvent) => {
        const g = gestureRef.current;
        gestureRef.current = null;
        window.clearTimeout(peekTimerRef.current);
        if (!g) return;
        if (g.moved) {
          endDrag(e.clientX, e.clientY);
          return;
        }
        if (g.peeked) {
          setZoomCard(null);
          return;
        }
        tapHand(g.i);
      },
      onPointerCancel: () => {
        const g = gestureRef.current;
        gestureRef.current = null;
        window.clearTimeout(peekTimerRef.current);
        setZoomCard(null);
        if (g?.moved) {
          const d = dragRef.current;
          setDrag(null);
          setTargeting(null);
          if (d) {
            flyCard({
              cardId: d.cardId,
              from: { x: d.x, y: d.y, w: handW },
              to: spot.hand(PLAYER),
              faceFrom: 'front',
              faceTo: 'front',
              poseFrom: 'stand',
              poseTo: 'stand',
              arc: 10,
              duration: 240,
            });
          }
        }
      },
    };
  }

  /**
   * 手札1枚ごとの「今この瞬間の実効値」（消費APと予想ダメージ）。
   * カードに書かれた素の値をそのまま出すと、フィールドやスイッチでコストが変わっている時に
   * 表示と実際が食い違う（実際に「新たな地平線」で-1されていても素の数字が出ていた）。
   * predictSkill は状態を複製するので、値が変わりうる要素をキーにして計算を絞る。
   */
  const liveHand = useMemo(() => {
    const map = new Map<number, { cost: number; value: number }>();
    me.hand.forEach((id, i) => {
      const card = safeCard(id);
      if (!card || card.type !== 'skill') return;
      try {
        const pred = predictSkill(state, PLAYER, card);
        if (pred) map.set(i, { cost: pred.cost, value: pred.kind === 'attack' ? pred.value : card.baseValue });
      } catch {
        /* 予測できないカードは素の値のまま */
      }
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    me.hand.join(','),
    me.actorIndex,
    me.ap.length,
    me.nextSkillCostDelta,
    state.field?.cardId,
    state.turn,
    state.phase,
  ]);

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
    // 対象を選ぶ間、それぞれの相手に「HP いくつ → いくつ」を出すための予測
    let preview: NonNullable<Targeting>['preview'];
    if (card.type === 'skill') {
      const p = predictSkill(state, PLAYER, card);
      if (p) preview = { side, indexes: [...map.keys()], kind: p.kind, value: p.value };
    }
    setTargeting({ side, hint, actions: map, preview });
  }

  /**
   * 盤面のキャラのタップ。
   * - 対象選択中で「選べる対象」なら、選択として扱う
   * - それ以外は単押しでカードを拡大表示する（βレビュー: 効果を見るのに長押しは気づけない）
   *   長押しでも拡大できるのは今までどおり
   */
  function tapChar(side: 0 | 1, index: number) {
    if (targeting && side === targeting.side) {
      const action = targeting.actions.get(index);
      if (action) act(action);
      return; // 選択中に選べない対象を押しても拡大は出さない（誤爆で選択が隠れるため）
    }
    const c = view.players[side].characters[index];
    if (c) setZoomCard(c.cardId);
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

  /**
   * 攻撃カードの「誰がどうなるか」。
   * ダメージの数字だけでは倒せるのか分からないので、対象のHPが実際にいくつになるかを出す。
   * 対象の決まり方はエンジンの効果定義（targeting）が唯一の正。UIで推測しない。
   */
  function attackOutcome(card: SkillCard, value: number) {
    const targeting = skillEffectOf(card.id)?.targeting ?? 'actor';
    if (targeting === 'choose') return null; // 選ぶカードは対象選択モードで出す
    const indexes =
      targeting === 'all'
        ? foe.characters.map((_, i) => i).filter((i) => isCharAlive(view, ENEMY, i))
        : targeting === 'standby'
          ? foe.characters.map((_, i) => i).filter((i) => i !== foe.actorIndex && isCharAlive(view, ENEMY, i))
          : [foe.actorIndex];
    const rows = indexes
      .filter((i) => isCharAlive(view, ENEMY, i))
      .map((i) => {
        const maxHp = maxHpOf(view, ENEMY, i);
        const hp = Math.max(0, maxHp - foe.characters[i].damage);
        const after = Math.max(0, hp - value);
        return { i, name: foe.characters[i].name.replace(/^\[[^\]]*\]/, ''), hp, after };
      });
    if (rows.length === 0) return null;
    return (
      <span className="predict outcome">
        {rows.map((r) => (
          <span key={r.i} className={`outcome-row ${r.after === 0 ? 'ko' : ''}`}>
            {r.name} <b>{r.hp}</b>
            <em>→</em>
            <b>{r.after}</b>
            {r.after === 0 && <i>撃破</i>}
          </span>
        ))}
      </span>
    );
  }

  const fieldCard = view.field ? cardById(view.field.cardId) : null;

  const choicePhase = state.phase === 'choice' && isMyTurn && !busy;

  return (
    <div
      ref={rootRef}
      className={[
        'battle-root',
        finished ? '' : isMyTurn ? 'my-turn' : 'enemy-turn',
        targeting ? 'targeting-mode' : '',
        drag ? 'dragging' : '',
        // キャラ以外の置き場所（APゾーン・フィールド枠）も掴んでいる間だけ光らせる
        drag?.zones.some((z) => z.key === 'ap') ? 'drop-ap' : '',
        drag?.zones.some((z) => z.key === 'field') ? 'drop-field' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      // 盤面の寸法はここで一度だけ決めて、CSS変数でCSS側へ渡す。
      // CSSに固定pxで書くと、画面サイズごとの @media が積み重なって収拾がつかなくなる（実際になった）。
      // パイルのはみ出し量だけは上の useLayoutEffect が1枚ずつ実測して上書きする。
      style={
        {
          '--card-w': `${cardW}px`,
          '--pile-w': `${pileW}px`,
          '--pile-gap': `${pileGap}px`,
          '--zone-vis': `${ZONE_VISIBLE}px`,
          '--strip-h': `${STRIP_H}px`,
        } as React.CSSProperties
      }
    >
      {/* 卓の上に敷くフィールドの絵（一番後ろ） */}
      <FieldBackdrop cardId={fieldCard?.id ?? null} />

      {/* ターンバッジ（常時表示） */}
      {!finished && (
        <div className={`turn-badge ${isMyTurn ? 'mine' : 'theirs'}`}>
          {isMyTurn ? 'あなたのターン' : '相手のターン'}
        </div>
      )}
      {/* 相手情報バー（表層UI） */}
      <div className="info-bar">
        <span className="deck-name"><em className="vs">vs</em> {setup.enemy.name}</span>
        {/* ターンとフェーズは中央の情報帯へ移した（盤面を見たまま今どこか分かるように） */}
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
        <div className={`board ${camClass}`} ref={boardRef}>
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

          {/* 相手エリア。ゾーン列はエリアの中で絶対配置なので、エリアの高さには影響しない。
           * 流れの中に置いていた頃は、ゾーン列（276px）が陣形（207px）より背が高いせいで
           * エリアの高さがゾーン列に引っ張られ、自分側の下に 63px の死に余白ができていた。
           * さらに片側だけ場所を取るので、敵味方のアクターの中心が 30px ズレていた。 */}
          <div className="area enemy-area">
            <ZoneCol
              side={ENEMY} p={foe} deckRef={deckRefE} apRef={apRefE} trashRef={trashRefE}
              onOpenPile={(kind) => {
                if (kind === 'trash') setPileList({ title: '相手のトラッシュ', cards: foe.trash });
                if (kind === 'ap') setPileList({ title: '相手のAPエリア', cards: foe.ap });
              }}
            />
            <Formation
              side={ENEMY} state={view} pops={pops} targeting={targeting}
              onTap={tapChar} koShown={koShown} cardW={cardW} vfxList={vfxList}
              plates={plates} motions={motions} onZoom={setZoomCard}
            />
          </div>

          {/* 中央の情報帯。ここは「絶対に何も重ならない領域」として高さを確保している。
           * 中央は敵味方のアクターが向かい合う場所なので、帯を作らずにフィールドを置くと
           * 構造的に必ず潰れる（実測で上下から17px/15px食われて素通しがほぼ0だった）。
           * フィールドは左端へ。右下は自分の山札・AP・トラッシュと親指の定位置で混んでいる。 */}
          <div className="field-strip">
            <div
              className={`strip-field ${fieldCard ? 'has' : ''}`}
              onClick={() => fieldCard && setZoomCard(fieldCard.id)}
            >
              {fieldCard ? (
                <>
                  <CardFrame card={fieldCard} width={Math.round(STRIP_H * 0.58)} />
                  <span className="strip-field-name">{fieldCard.name}</span>
                </>
              ) : (
                <span className="strip-field-none">FIELD</span>
              )}
            </div>
            {/* 続いている状態（被ダメージ軽減・ロック・次のコスト/ドロー）。
             * 何もかかっていなければ何も出ない。帯の真ん中はそのための空き */}
            <span className="strip-status">
              <StatusBadges p={foe} turn={state.turn} mine={false} />
              <StatusBadges p={me} turn={state.turn} mine />
            </span>
            <div className="phase-pill">
              <b className="turn-num">T{state.turn}</b>
              {isMyTurn ? (
                <>
                  <em className={state.phase === 'play' || state.phase === 'choice' ? 'on' : ''}>メイン</em>
                  <em className={state.phase === 'charge' ? 'on' : ''}>チャージ</em>
                </>
              ) : (
                <em className="theirs on">相手</em>
              )}
            </div>
          </div>

          {/* 自分エリア（相手エリアと同じ作り） */}
          <div className="area my-area">
            <ZoneCol
              side={PLAYER} p={me} deckRef={deckRefP} apRef={apRefP} trashRef={trashRefP}
              apDelta={chargeSel.size}
              onOpenPile={(kind) => {
                if (kind === 'trash') setPileList({ title: '自分のトラッシュ', cards: me.trash });
                if (kind === 'ap') setPileList({ title: '自分のAPエリア', cards: me.ap });
                if (kind === 'deck')
                  setPileList({
                    title: '自分の山札に残っているカード',
                    cards: me.deck,
                    grouped: true,
                    note: '種類とコスト順に並べています（山札の本当の並び順ではありません）',
                  });
              }}
            />
            <Formation
              side={PLAYER} state={view} pops={pops} targeting={targeting}
              onTap={tapChar} koShown={koShown} cardW={cardW} vfxList={vfxList}
              plates={plates} motions={motions} onZoom={setZoomCard}
            />
          </div>
        </div>
      </div>

      {/* 自分の手札（扇状に持つ。カードの増減はキーを固定してなめらかに詰める） */}
      {/* 箱の高さは「カードの高さ(幅×1.4) + 扇の反り + 持ち上げ分」ぶんだけ。
       * 1.72 は余りすぎていて、そのぶん盤面が下へ押し出されていた（→アクターのHPが隠れる） */}
      <div className="my-hand" ref={handRefP} style={{ height: Math.round(handW * 1.58) }}>
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
            // コストは常に見せる（B-5）。以前はメインフェーズ中だけだったので、
            // チャージフェーズや相手のターンに「次に何が撃てるか」を数えられなかった
            const showCost = card.type === 'skill';
            const live = liveHand.get(i);
            // 表示も判定も「実際に払う額」で行う（素の costAp は使わない）
            const cost = live?.cost ?? (card.type === 'skill' ? card.costAp : 0);
            const lackAp = card.type === 'skill' && me.ap.length < cost;
            const costChanged = card.type === 'skill' && live !== undefined && live.cost !== card.costAp;
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
                  drag?.handIndex === i ? 'dragging' : '', // 掴んでいる間、元の位置からは消す
                ].join(' ')}
                style={{
                  left: `calc(50% + ${Math.round(off * step)}px)`,
                  top: 8,
                  zIndex: i,
                  transform: `translateX(-50%) rotate(${arcRot}deg) translateY(${Math.round(arcY)}px)${picked ? ' scale(1.08)' : ''}`,
                  transformOrigin: '50% 115%',
                }}
                {...handGesture(i)}
              >
                <CardFrame card={card} width={handW} upright live={live} />
                {picked && <img className="pick-badge" src={IMG('icon_bolt')} alt="チャージ予定" />}
                {showCost && (
                  <span
                    className={[
                      'cost-chip',
                      lackAp ? 'lack' : '',
                      costChanged ? (live!.cost < card.costAp ? 'cheaper' : 'pricier') : '',
                    ].join(' ')}
                    title={
                      costChanged
                        ? `コスト${card.costAp} → ${cost}（効果で変化）`
                        : lackAp
                          ? 'APが足りない'
                          : `コスト${cost}`
                    }
                  >
                    {cost}
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
              state.players[PLAYER].hand.length >= 5 && state.players[PLAYER].chargedThisTurn === 0 ? (
                <span className="hint">手札が5枚以上: 1枚以上チャージしてください</span>
              ) : (
                <button className="chip" onClick={() => act({ type: 'endTurn' })}>チャージせずターンエンド</button>
              )
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
                <div key={hi} className="hand-card playable" onClick={() => setPreviewGuard(hi)}>
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

      {/* 動いているカード（使ったカードを中央で見せるのも、ここが担う） */}
      <CardStage moves={moves} onDone={(key) => setMoves((prev) => prev.filter((m) => m.key !== key))} />

      {/* 掴んでいるカード。指について回り、置ける場所の上では少し大きくなる */}
      {drag && safeCard(drag.cardId) && (
        <div
          ref={dragCardRef}
          className={`drag-card ${drag.over ? 'over' : ''}`}
          style={{ transform: `translate3d(${drag.x}px, ${drag.y}px, 0) translate(-50%, -62%)` }}
        >
          <CardFrame card={safeCard(drag.cardId)!} width={Math.round(handW * 1.2)} upright />
        </div>
      )}

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
                  {/* 「ダメージ12」だけでは倒せるのか分からない。誰がどうなるかまで出す（B-2）。
                   * 対象を選べないカード（＝ほとんどの攻撃）は対象選択モードに入らないので、
                   * ここで見せないと予定を知る機会が無い */}
                  {p.kind === 'attack' && attackOutcome(card, p.value)}
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

      {/* ガードカードの使用前確認（攻撃スキルと同じ「見る→使う」の2段階） */}
      {previewGuard !== null && previewGuard < me.hand.length && (
        <div className="overlay preview" onClick={() => setPreviewGuard(null)}>
          <div className="preview-inner" onClick={(e) => e.stopPropagation()}>
            <CardFrame card={cardById(me.hand[previewGuard])} width={Math.min(300, Math.max(230, window.innerWidth * 0.72))} upright />
            {(() => {
              const card = cardById(me.hand[previewGuard]);
              if (card.type !== 'skill' || !state.pendingAttack) return null;
              const after = Math.max(0, state.pendingAttack.value - card.baseValue);
              return (
                <div className="predict-row">
                  <span className="predict grd">
                    ダメージ <b>{state.pendingAttack.value}</b><em> → </em><b>{after}</b>
                  </span>
                  <span className="predict cost">コスト <b>{card.costAp}</b></span>
                </div>
              );
            })()}
            <div className="dialog-btns">
              <button
                className="big-btn slim"
                onClick={() => {
                  const hi = previewGuard;
                  setPreviewGuard(null);
                  act({ type: 'playGuard', handIndex: hi });
                }}
              >
                このカードでガードする
              </button>
              <button className="chip" onClick={() => setPreviewGuard(null)}>やめる</button>
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

      {/* トラッシュ・AP・山札のリスト表示 */}
      {pileList && (
        <div className="overlay" onClick={() => setPileList(null)}>
          <div className="dialog pile-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{pileList.title}（{pileList.cards.length}枚）</h3>
            {pileList.note && <p className="hint pile-note">{pileList.note}</p>}
            <div className="pile-grid">
              {pileList.cards.length === 0 && <p className="hint">まだカードがありません</p>}
              {(pileList.grouped ? groupPile(pileList.cards) : [...pileList.cards].reverse().map((id) => ({ id, count: 1 }))).map(
                ({ id, count }, i) =>
                  safeCard(id) ? (
                    <div key={`${id}-${i}`} className="pile-grid-card" onClick={() => setZoomCard(id)}>
                      <CardFrame card={safeCard(id)!} width={72} upright />
                      {count > 1 && <span className="pile-x">×{count}</span>}
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

      {/* 横持ちだと盤面が入りきらない（控えのHPや山札が画面の外に出る）ので、縦持ちをお願いする */}
      {needsPortrait && (
        <div className="rotate-hint">
          <img src={IMG('icon_sword')} alt="" />
          {/* 指で触る端末なら「回してください」、マウスの端末なら「窓を縦長に」。
           * 以前はPCでも「スマホを縦にしてください」と出ていて、回しようがなかった */}
          <p>{isTouchDevice() ? '画面を縦にしてください' : 'ウィンドウを高くしてください'}</p>
          {/* どこまで足りないのかを数字で出す。「縦にして」だけだと、
           * すでに縦なのに出ている時に何をすればいいのか分からない */}
          <small>
            バトル画面には高さ {MIN_BOARD_HEIGHT}px 以上が必要です（今 {vh}px）。
            <br />
            足りないと山札や控えのHPが画面の外に出てしまいます。
          </small>
        </div>
      )}

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



/**
 * 山札の中身表示用に「同じカードをまとめて、種類→コスト→ID順」に並べ直す。
 * 山札の本当の並び（次に引く順）は絶対に出さない。並べ替えることで
 * 「何が残っているか」だけが分かり、「次に何を引くか」は分からないようにしている。
 */
function groupPile(cards: string[]): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const id of cards) counts.set(id, (counts.get(id) ?? 0) + 1);
  const typeRank = (id: string) => {
    const c = safeCard(id);
    if (!c) return 9;
    return c.type === 'character' ? 0 : c.type === 'equipment' ? 1 : c.type === 'field' ? 2 : 3;
  };
  const cost = (id: string) => {
    const c = safeCard(id);
    return c && c.type === 'skill' ? c.costAp : -1;
  };
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => typeRank(a.id) - typeRank(b.id) || cost(a.id) - cost(b.id) || a.id.localeCompare(b.id));
}

/** バトル内容の要約（ログ用）: 使われたカード・チャージ回数などをイベントから集計 */
function summarizeBattle(state: BattleState) {
  const used: [Record<string, number>, Record<string, number>] = [{}, {}];
  const charges = [0, 0];
  const damage = [0, 0]; // その側が「与えた」ダメージ
  for (const e of state.events) {
    if (e.t === 'skillUsed' || e.t === 'characterCardUsed' || e.t === 'castFromDeck' || e.t === 'guardPlayed' || e.t === 'equip' || e.t === 'fieldSet') {
      used[e.player][e.cardId] = (used[e.player][e.cardId] ?? 0) + 1;
    }
    if (e.t === 'chargeHand') charges[e.player]++;
    if (e.t === 'damage') damage[1 - e.player]++;
  }
  return { usedByPlayer: used[0], usedByEnemy: used[1], chargesPlayer: charges[0], chargesEnemy: charges[1] };
}

function ResultOverlay({ state, setup, onExit, onRematch }: {
  state: BattleState;
  setup: BattleSetup;
  onExit: () => void;
  onRematch: () => void;
}) {
  const won = state.winner === PLAYER;
  const reason = state.endReason === 'wipeout' ? '全滅' : state.endReason === 'deckout' ? '山札切れ' : '時間切れ';
  const [stars, setStars] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [reviewSent, setReviewSent] = useState(false);
  // リザルトは2段階: まずレビュー → 送信(orスキップ)後にシェア・ボタン類
  const [step, setStep] = useState<'review' | 'after'>('review');

  // バトル終了ログ（リザルト表示時に1回だけ）
  useEffect(() => {
    logEvent('battle_end', {
      playerDeck: setup.playerDeckName,
      playerDeckKind: setup.playerDeckKind,
      enemyDeck: setup.enemy.name,
      enemyRandom: setup.enemyRandom,
      winner: state.winner === null ? 'draw' : state.winner === PLAYER ? 'player' : 'enemy',
      reason: state.endReason,
      turns: state.turn,
      ...summarizeBattle(state),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sendReview() {
    logEvent('review', {
      stars,
      text: reviewText.slice(0, 1000),
      playerDeck: setup.playerDeckName,
      enemyDeck: setup.enemy.name,
      winner: state.winner === PLAYER ? 'player' : state.winner === null ? 'draw' : 'enemy',
      turns: state.turn,
    });
    setReviewSent(true);
    setStep('after');
  }
  // シェア: バトルログをURLに埋め込んだプレビューページを付ける
  const [logUrl, setLogUrl] = useState(SITE_URL);
  useEffect(() => {
    const sum = summarizeBattle(state);
    const shared: SharedLog = {
      v: 1,
      pd: setup.playerDeckName,
      ed: setup.enemy.name,
      w: state.winner === null ? 'd' : state.winner === PLAYER ? 'p' : 'e',
      r: state.endReason ?? '',
      t: state.turn,
      pc: setup.playerDeck.characterIds,
      ec: setup.enemy.deck.characterIds,
      pu: Object.entries(sum.usedByPlayer),
      eu: Object.entries(sum.usedByEnemy),
    };
    void encodeSharedLog(shared).then((token) => setLogUrl(`${SITE_URL}#log=${token}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const verdict =
    state.winner === null ? '引き分け' : `${reason}${won ? '勝利' : '負け'}`;
  const line = won
    ? `「${setup.playerDeckName}」で「${setup.enemy.name}」に勝利！！`
    : state.winner === null
      ? `「${setup.playerDeckName}」で「${setup.enemy.name}」と激闘！`
      : `「${setup.playerDeckName}」で「${setup.enemy.name}」に挑戦！`;
  const text = `#ブレデュエ\n${line}｜${state.turn}ターン｜${verdict}\n`;
  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(logUrl)}`;

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
        {step === 'review' ? (
          /* 第1段階: レビュー（毎回表示） */
          <div className="review-box">
            <p className="review-title">このバトルはどうでしたか？</p>
            <div className="review-stars">
              {[1, 2, 3, 4, 5].map((n) => (
                <span
                  key={n}
                  className={`review-star ${n <= stars ? 'on' : ''}`}
                  onClick={() => setStars(n)}
                >
                  ★
                </span>
              ))}
            </div>
            <label className="review-text-label" htmlFor="review-text">
              ひとことメモ（任意・1000文字まで）
            </label>
            <textarea
              id="review-text"
              className="review-text"
              placeholder="ここをタップして感想・気づいたことを入力…"
              maxLength={1000}
              rows={3}
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
            />
            <button className="big-btn review-send" disabled={stars === 0} onClick={sendReview}>
              {stars === 0 ? '★を選んで送信' : '送信する'}
            </button>
            <button className="review-skip" onClick={() => setStep('after')}>
              今回はスキップ
            </button>
          </div>
        ) : (
          /* 第2段階: シェアと次の行動 */
          <>
            {reviewSent && <p className="review-thanks">ご意見ありがとうございました！</p>}
            <a className="big-btn slim share" href={shareUrl} target="_blank" rel="noreferrer">
              𝕏 で結果をシェア
            </a>
            <div className="dialog-btns">
              <button className="chip" onClick={onExit}>ホームへ</button>
              <button className="big-btn slim" onClick={onRematch}>もう一回</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
