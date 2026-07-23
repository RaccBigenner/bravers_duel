/**
 * バトル画面の状態管理フック。
 *
 * エンジンの本当の状態（realState）は行動を適用した瞬間に最終形になるが、
 * 画面には「表示用ステート（view）」を映す。view は演出イベントが1件
 * 再生されるたびに、そのイベントの内容だけ進む。これにより
 * 「カードが飛んでから枚数が減る」「カットインの後にHPが減る」など、
 * 状態の変化と物理演出が正しく同期する。
 * 演出キューが空になった時点で view は realState に完全同期される。
 */
import {
  actingPlayer,
  applyAction,
  cardById,
  createBattle,
  isCharAlive,
  legalActions,
  maxHpOf,
  simpleAi,
  type Attribute,
  type BattleAction,
  type BattleAi,
  type BattleState,
  type DeckList,
} from '@bravers/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { narrate, type NarrEvent } from './narrator';

export interface DamagePop {
  key: number;
  side: 0 | 1;
  charIndex: number;
  amount: number; // マイナスなら回復
}

const AI_THINK_MS = 650;
const PLAYER = 0 as const;
const ENEMY = 1 as const;

let uniq = 1;
/** 再生速度はバトルをまたいで覚えておく（リロードでは戻る） */
let savedSpeed = 1;

/** 表示用ステートに演出イベント1件ぶんの変化を適用する */
function applyEventToView(view: BattleState, ev: NarrEvent): void {
  const s = (ev.side ?? 0) as 0 | 1;
  const p = view.players[s];

  const removeFromHandById = (side: 0 | 1, cardId: string) => {
    const hand = view.players[side].hand;
    const i = hand.indexOf(cardId);
    if (i >= 0) hand.splice(i, 1);
    else hand.pop(); // 見つからなければ枚数だけ合わせる
  };
  const removeFromHandByName = (side: 0 | 1, name: string) => {
    const hand = view.players[side].hand;
    const i = hand.findIndex((id) => cardById(id).name === name);
    if (i >= 0) hand.splice(i, 1);
    else hand.pop();
  };

  switch (ev.kind) {
    case 'turn':
      if (ev.side !== undefined) view.active = ev.side;
      break;
    case 'draw': {
      const n = Math.min(ev.amount ?? 1, p.deck.length);
      p.hand.push(...p.deck.splice(0, n));
      break;
    }
    case 'charge': {
      if (ev.cardName) removeFromHandByName(s, ev.cardName);
      else p.hand.pop();
      p.ap.push('charged');
      break;
    }
    case 'chargeDeck': {
      const n = Math.min(ev.amount ?? 1, p.deck.length);
      p.ap.push(...p.deck.splice(0, n));
      break;
    }
    case 'chargeTrash': {
      const n = Math.min(ev.amount ?? 1, p.trash.length);
      p.ap.push(...p.trash.splice(0, n));
      break;
    }
    case 'chargeAll': {
      p.ap.push(...p.hand.splice(0));
      break;
    }
    case 'mill': {
      const n = Math.min(ev.amount ?? 1, p.deck.length);
      p.trash.push(...p.deck.splice(0, n));
      break;
    }
    case 'apTrash': {
      const n = Math.min(ev.amount ?? 1, p.ap.length);
      p.trash.push(...p.ap.splice(0, n));
      break;
    }
    case 'handTrash': {
      p.trash.push(...p.hand.splice(0));
      break;
    }
    case 'lock': {
      if (ev.side !== undefined) p.actorLockUntilTurn = ev.amount ?? view.turn;
      break;
    }
    case 'unlock': {
      if (ev.side !== undefined) p.actorLockUntilTurn = 0;
      break;
    }
    case 'search': {
      // デッキから名前で探して手札へ（見つからなくても枚数だけ合わせる）
      if (ev.cardName) {
        const i = p.deck.findIndex((id) => cardById(id).name === ev.cardName);
        if (i >= 0) p.hand.push(...p.deck.splice(i, 1));
        else if (p.deck.length > 0) p.hand.push(p.deck.pop()!);
      }
      break;
    }
    case 'play':
    case 'guard': {
      if (ev.card) removeFromHandById(s, ev.card.id);
      // トラッシュへの移動はカットイン後（呼び出し側が遅延で積む）
      break;
    }
    case 'damage': {
      if (ev.side !== undefined && ev.charIndex !== undefined) {
        const c = view.players[ev.side].characters[ev.charIndex];
        c.damage += ev.amount ?? 0;
      }
      break;
    }
    case 'heal': {
      if (ev.side !== undefined && ev.charIndex !== undefined) {
        const c = view.players[ev.side].characters[ev.charIndex];
        c.damage = Math.max(0, c.damage - (ev.amount ?? 0));
      }
      break;
    }
    case 'revive': {
      if (ev.side !== undefined && ev.charIndex !== undefined) {
        const c = view.players[ev.side].characters[ev.charIndex];
        c.damage = Math.max(0, maxHpOf(view, ev.side, ev.charIndex) - (ev.amount ?? 1));
      }
      break;
    }
    case 'actor': {
      if (ev.side !== undefined && ev.charIndex !== undefined) {
        view.players[ev.side].actorIndex = ev.charIndex;
      }
      break;
    }
    case 'equip': {
      if (ev.side !== undefined && ev.charIndex !== undefined && ev.card) {
        removeFromHandById(ev.side, ev.card.id);
        view.players[ev.side].characters[ev.charIndex].equipmentCardId = ev.card.id;
      }
      break;
    }
    case 'field': {
      if (ev.card && ev.side !== undefined) {
        removeFromHandById(ev.side, ev.card.id);
        view.field = { cardId: ev.card.id, owner: ev.side };
      }
      break;
    }
    case 'attr': {
      if (ev.side !== undefined && ev.charIndex !== undefined && ev.attr) {
        view.players[ev.side].characters[ev.charIndex].addedAttributes.push(ev.attr as Attribute);
      }
      break;
    }
    default:
      break;
  }
}

export function useBattle(playerDeck: DeckList, enemyDeck: DeckList) {
  const stateRef = useRef<BattleState | null>(null);
  const viewRef = useRef<BattleState | null>(null);
  if (stateRef.current === null) {
    stateRef.current = createBattle([playerDeck, enemyDeck], Math.floor(Math.random() * 1e9), { manualFor: PLAYER }); // 人間側の任意能力は手動発動
    viewRef.current = structuredClone(stateRef.current);
  }
  const state = stateRef.current;

  const [version, setVersion] = useState(0);
  const [queue, setQueue] = useState<NarrEvent[]>([]);
  const [current, setCurrent] = useState<NarrEvent | null>(null);
  const [pops, setPops] = useState<DamagePop[]>([]);
  const [koShown, setKoShown] = useState<Set<string>>(new Set());
  const aiRef = useRef<BattleAi>(simpleAi({ keepHand: 2 }));
  const [speed, setSpeedState] = useState(savedSpeed);
  const speedRef = useRef(savedSpeed);
  const setSpeed = useCallback((s: number) => {
    savedSpeed = s;
    speedRef.current = s;
    setSpeedState(s);
  }, []);

  const busy = queue.length > 0 || current !== null;
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // 演出用タイマーは全部ここで管理し、画面を離れたら確実に止める
  // （放置するとアンマウント後に発火して不要な処理が走る）
  const timersRef = useRef<number[]>([]);
  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((t) => t !== id);
      fn();
    }, ms);
    timersRef.current.push(id);
  }, []);
  useEffect(() => () => timersRef.current.forEach((t) => window.clearTimeout(t)), []);

  /** 開幕処理のイベントも演出として再生（表示状態には適用しない: すでに反映済みのため） */
  const bootRef = useRef(false);
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    const s = stateRef.current!;
    const events = s.events
      .map((e) => narrate(s, e))
      .filter((e): e is NarrEvent => e !== null)
      .map((e) => ({ ...e, noApply: true }));
    setQueue(events);
  }, []);

  /** 行動を適用し、新しく起きたイベントを演出キューへ */
  const perform = useCallback((action: BattleAction) => {
    const s = stateRef.current!;
    const seqBefore = s.eventSeq;

    applyAction(s, action);

    const newCount = s.eventSeq - seqBefore;
    const newEvents = newCount > 0 ? s.events.slice(-Math.min(newCount, s.events.length)) : [];
    const events = newEvents.map((e) => narrate(s, e)).filter((e): e is NarrEvent => e !== null);
    setQueue((q) => [...q, ...events]);
    bump();
  }, [bump]);

  // 演出キューの再生ループ
  useEffect(() => {
    if (current !== null) return;
    if (queue.length === 0) {
      // 全部再生し終わったら表示状態を本当の状態に完全同期
      const s = stateRef.current!;
      viewRef.current = structuredClone(s);
      setKoShown(() => {
        const next = new Set<string>();
        s.players.forEach((p, si) =>
          p.characters.forEach((_, ci) => {
            if (!isCharAlive(s, si as 0 | 1, ci)) next.add(`${si}-${ci}`);
          }),
        );
        return next;
      });
      bump();
      return;
    }
    // 再生速度を反映（演出の長さを縮める。以降この ev.duration を使う）
    const ev: NarrEvent = { ...queue[0], duration: Math.max(140, Math.round(queue[0].duration / speedRef.current)) };
    setQueue((q) => q.slice(1));
    setCurrent(ev);

    // 表示状態をこのイベントのぶんだけ進める
    if (!ev.noApply && viewRef.current) {
      applyEventToView(viewRef.current, ev);
      // 使用カードはカットインの後にトラッシュへ落ちる
      if ((ev.kind === 'play' || ev.kind === 'guard') && ev.card && ev.side !== undefined) {
        const cardId = ev.card.id;
        const side = ev.side;
        later(() => {
          viewRef.current?.players[side].trash.push(cardId);
          bump();
        }, Math.max(0, ev.duration - 380));
      }
    }

    // ダメージ・回復ポップ（イベント再生の瞬間に出す）
    if ((ev.kind === 'damage' || ev.kind === 'heal') && ev.side !== undefined && ev.charIndex !== undefined) {
      const pop: DamagePop = {
        key: uniq++,
        side: ev.side,
        charIndex: ev.charIndex,
        amount: ev.kind === 'damage' ? (ev.amount ?? 0) : -(ev.amount ?? 0),
      };
      setPops((prev) => [...prev, pop]);
      later(() => setPops((prev) => prev.filter((x) => x.key !== pop.key)), 1100);
    }
    if (ev.kind === 'ko' && ev.side !== undefined && ev.charIndex !== undefined) {
      const key = `${ev.side}-${ev.charIndex}`;
      later(() => setKoShown((prev) => new Set(prev).add(key)), 350);
    }
    if (ev.kind === 'revive' && ev.side !== undefined && ev.charIndex !== undefined) {
      const key = `${ev.side}-${ev.charIndex}`;
      setKoShown((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }

    later(() => setCurrent(null), ev.duration);
    bump();
  }, [queue, current, bump, later]);

  // AIの手番（演出が終わってから考える）
  useEffect(() => {
    const s = stateRef.current!;
    if (busy || s.phase === 'finished') return;
    if (actingPlayer(s) !== ENEMY) return;
    const timer = window.setTimeout(() => {
      const s2 = stateRef.current!;
      if (s2.phase === 'finished' || actingPlayer(s2) !== ENEMY) return;
      perform(aiRef.current.choose(s2, ENEMY));
    }, AI_THINK_MS / speedRef.current);
    return () => window.clearTimeout(timer);
  }, [version, busy, perform]);

  return {
    state,
    /** 画面に映す用の状態（演出と同期して進む） */
    view: viewRef.current!,
    version,
    busy,
    current,
    pops,
    koShown,
    perform,
    myActions: !busy && actingPlayer(state) === PLAYER ? legalActions(state) : [],
    isMyTurn: actingPlayer(state) === PLAYER,
    speed,
    setSpeed,
  };
}
