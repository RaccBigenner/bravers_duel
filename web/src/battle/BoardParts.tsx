/**
 * バトル画面の盤面部品（表示専用コンポーネント）。
 * 状態を持つのは親（Battle）で、ここは描画とタップの通知だけを行う。
 */
import { cardById, effectiveAttributes, isCharAlive, maxHpOf, type BattleAction, type BattleState, type CharacterCard } from '@bravers/engine';
import { useEffect, useRef, useState } from 'react';
import { CardFrame } from '../CardFrame';
import { IMG } from '../cardAssets';
import type { NarrEvent } from './narrator';
import type { DamagePop } from './useBattle';

const PLAYER = 0 as const;
const ENEMY = 1 as const;

/** 対象選択モード。合法手から導出した「選べる対象 → 実行する行動」の表を持つ */
export type Targeting = {
  side: 0 | 1; // 対象側
  hint: string;
  actions: Map<number, BattleAction>; // charIndex → action
} | null;

/** 飛んでいくカードの演出 */
export interface Flight {
  key: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  faceCardId?: string;
}

export function longPressHandlers(onLong: () => void) {
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

export function extraAttributes(state: BattleState, side: 0 | 1, i: number): string[] {
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

export function Formation({ side, state, pops, targeting, onTap, koShown, cardW, vfxList, plates, motions, onZoom }: {
  side: 0 | 1;
  state: BattleState;
  pops: DamagePop[];
  targeting: Targeting;
  onTap: (side: 0 | 1, index: number) => void;
  koShown: Set<string>;
  cardW: number;
  vfxList: { key: number; side: 0 | 1; charIndex: number; img: string; delay: number }[];
  plates: { key: number; side: 0 | 1; charIndex: number; text: string; cls: string; offset: number; icon?: string }[];
  motions: { key: number; side: 0 | 1; charIndex: number; cls: string }[];
  onZoom?: (cardId: string) => void;
}) {
  const p = state.players[side];
  const n = p.characters.length;
  const step = 360 / Math.max(n, 1);
  // 横長の楕円ホイール: 横方向に大きく広げ、縦はつぶして省スペースにする。
  // 空いた縦の余白ぶんカード自体を大きくできる。
  const rx = Math.round(cardW * 1.24); // 横半径（カード同士が重ならない余白を確保）
  const ry = Math.round(cardW * 0.6); // 縦半径
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

  const width = Math.round(cardW * 3.2 + 8);
  const height = Math.round(cardW * 2.3 + 16);
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
        const myMotions = motions.filter((m) => m.side === side && m.charIndex === i);
        const myVfx = vfxList.filter((v) => v.side === side && v.charIndex === i);
        const extras = extraAttributes(state, side, i);
        const A = frontAngle - i * step + wheelRot + tilt;
        const rad = (A * Math.PI) / 180;
        const x = Math.round(Math.sin(rad) * rx * 10) / 10;
        // 前方（中央側）へのせり出しは0.8倍に抑える（敵味方のアクターが被らないように）
        const yRaw = -Math.cos(rad) * ry;
        const y = Math.round((yRaw < 0 ? yRaw * 0.8 : yRaw) * 10) / 10;
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
            <div
              className={[
                myPops.some((d) => d.amount > 0) ? 'card-hit' : '',
                ...myMotions.map((m) => m.cls),
              ].join(' ')}
            >
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

export function ZoneCol({ side, p, deckRef, apRef, trashRef, onOpenPile }: {
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

export function FlyGhost({ flight }: { flight: Flight }) {
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

export function NarrationBanner({ ev, mini = false }: { ev: NarrEvent; mini?: boolean }) {
  return (
    <div key={ev.key} className={`narration kind-${ev.kind} ${mini ? 'mini' : ''}`}>
      <span className="narr-text">{ev.text}</span>
    </div>
  );
}

export function TurnSplash({ mine, text }: { mine: boolean; text: string }) {
  return (
    <div className={`turn-splash ${mine ? 'mine' : 'theirs'}`}>
      <span>{text}</span>
    </div>
  );
}
