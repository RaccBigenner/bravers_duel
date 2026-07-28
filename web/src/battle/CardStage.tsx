/**
 * 飛んでいるカードだけを乗せる舞台。
 *
 * これまで「1枚のカードを使う」という1つの出来事が、3つの別々のDOMで表現されていた。
 *   - 手札のカード … 消えるだけ（動かない）
 *   - 画面中央に出る 190px のカード … `.reveal`（別物）
 *   - トラッシュへ飛ぶ 54px の裏面 … `FlyGhost`（さらに別物）
 * そのうえ飛翔カードは position:fixed で、3Dに傾いた卓の外を平面移動していた。
 *
 * ここに一本化して、**1枚のカードが山札→手札→盤面→トラッシュと連続して移動する**ようにする。
 *
 * 肝は「立つ／寝る」。
 *   - 手札 … 自分に正対して立つ（rotateX 0）
 *   - 卓・山札・トラッシュ・AP … 卓に沿って寝る（rotateX = 盤の傾き）
 * 移動中はその間を補間するので、「山札から起き上がって手札に来る」
 * 「手札から卓へ寝かされる」という紙の動きが出る。
 */
import { cardById } from '@bravers/engine';
import { useEffect, useRef } from 'react';
import { CardFrame } from '../CardFrame';
import { IMG } from '../cardAssets';

/** 卓の傾き。battle.css の .board の rotateX と合わせること */
const TABLE_TILT = 15;

/** カードが通過する場所。x,y は中心、w は幅 */
export interface Spot {
  x: number;
  y: number;
  w: number;
}

export interface CardMove {
  key: number;
  /** 表に見せるカード。無ければずっと裏 */
  cardId?: string;
  from: Spot;
  to: Spot;
  /** 途中で立ち寄って見せる場所（使用カードのカットイン）。無ければ直行 */
  via?: Spot;
  /** via で止まっている時間(ms) */
  hold?: number;
  faceFrom?: 'back' | 'front';
  faceTo?: 'back' | 'front';
  poseFrom?: 'stand' | 'lay';
  poseTo?: 'stand' | 'lay';
  /** 着地時に横倒しにする（APへのチャージ） */
  spin?: boolean;
  /** 弧の高さ(px)。紙は放物線を描いて飛ぶ */
  arc?: number;
  duration: number;
}

export function CardStage({ moves, onDone }: { moves: CardMove[]; onDone: (key: number) => void }) {
  return (
    <div className="card-stage">
      {moves.map((m) => (
        <FlyingCard key={m.key} move={m} onDone={onDone} />
      ))}
    </div>
  );
}

function FlyingCard({ move, onDone }: { move: CardMove; onDone: (key: number) => void }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const facesRef = useRef<HTMLDivElement>(null);
  // onDone は毎回作り直される関数なので、ref 経由で呼ぶ（アニメーションを貼り直さない）
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const { from, to, via } = move;
  // いちばん大きくなる場所の幅で描いて、あとは縮小で合わせる（拡大するとぼやけるため）
  const base = Math.max(from.w, to.w, via?.w ?? 0);

  useEffect(() => {
    const body = bodyRef.current;
    const faces = facesRef.current;
    if (!body || !faces) return;

    const { duration, hold = 0, arc = 0, spin } = move;
    const tiltOf = (p?: 'stand' | 'lay') => (p === 'lay' ? TABLE_TILT : 0);
    const at = (s: Spot, tilt: number, lift = 0, roll = 0) =>
      `translate3d(${s.x}px, ${s.y - lift}px, 0) translate(-50%, -50%)` +
      ` rotateX(${tilt}deg) rotate(${roll}deg) scale(${s.w / base})`;

    const tiltFrom = tiltOf(move.poseFrom);
    const tiltTo = tiltOf(move.poseTo);
    const rollTo = spin ? 90 : 0;

    const frames: Keyframe[] = [];
    if (via) {
      // 手札 → 中央で見せる → トラッシュ。止まっている時間は duration に含める
      const inAt = 0.34;
      const outAt = Math.min(0.9, inAt + hold / Math.max(duration, 1));
      frames.push({ offset: 0, transform: at(from, tiltFrom) });
      frames.push({ offset: inAt, transform: at(via, 0), easing: 'cubic-bezier(0.2,0.8,0.3,1)' });
      frames.push({ offset: outAt, transform: at(via, 0) });
      frames.push({ offset: 1, transform: at(to, tiltTo, 0, rollTo) });
    } else {
      // 直行。真ん中で少し持ち上げて放物線にする
      const mid: Spot = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, w: (from.w + to.w) / 2 };
      frames.push({ offset: 0, transform: at(from, tiltFrom) });
      frames.push({ offset: 0.5, transform: at(mid, (tiltFrom + tiltTo) / 2, arc, rollTo / 2) });
      frames.push({ offset: 1, transform: at(to, tiltTo, 0, rollTo) });
    }

    const anim = body.animate(frames, {
      duration,
      easing: 'cubic-bezier(0.35,0.05,0.2,1)', // 最後にストンと落ちる
      fill: 'forwards',
    });

    // 表裏の返し。着地ぎわで翻す（ドローで「引いた瞬間に見える」感じを作る）
    const yFrom = move.faceFrom === 'back' ? 180 : 0;
    const yTo = move.faceTo === 'back' ? 180 : 0;
    let flip: Animation | null = null;
    if (yFrom !== yTo) {
      flip = faces.animate(
        [
          { offset: 0, transform: `rotateY(${yFrom}deg)` },
          { offset: via ? 0.18 : 0.55, transform: `rotateY(${yFrom}deg)` },
          { offset: via ? 0.34 : 0.95, transform: `rotateY(${yTo}deg)` },
          { offset: 1, transform: `rotateY(${yTo}deg)` },
        ],
        { duration, easing: 'ease-in-out', fill: 'forwards' },
      );
    } else {
      faces.style.transform = `rotateY(${yFrom}deg)`;
    }

    anim.onfinish = () => doneRef.current(move.key);
    return () => {
      anim.cancel();
      flip?.cancel();
    };
    // move は生成後に書き換えないので、貼り直しは不要
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const card = move.cardId ? safeCard(move.cardId) : null;
  return (
    <div className="fly-card" ref={bodyRef}>
      <div className="fly-card-faces" ref={facesRef}>
        <div className="fly-face front">
          {card ? <CardFrame card={card} width={base} /> : <img src={IMG('back')} width={base} alt="" />}
        </div>
        <div className="fly-face back">
          <img src={IMG('back')} width={base} alt="" />
        </div>
      </div>
    </div>
  );
}

function safeCard(id: string) {
  try {
    return cardById(id);
  } catch {
    return null;
  }
}
