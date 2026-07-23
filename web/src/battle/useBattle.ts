/**
 * バトル画面の状態管理フック。
 * 行動を適用すると、起きたこと（ログ差分）を演出イベント列に変換し、
 * 1件ずつ順番に再生する。再生が終わるまで次の行動（AI含む）は始まらない。
 */
import {
  actingPlayer,
  applyAction,
  createBattle,
  isCharAlive,
  legalActions,
  simpleAi,
  type BattleAction,
  type BattleAi,
  type BattleState,
  type DeckList,
} from '@bravers/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { classify, type NarrEvent } from './narrator';

export interface DamagePop {
  key: number;
  side: 0 | 1;
  charIndex: number;
  amount: number; // マイナスなら回復
}

const AI_THINK_MS = 500;
const PLAYER = 0 as const;
const ENEMY = 1 as const;

let uniq = 1;

export function useBattle(playerDeck: DeckList, enemyDeck: DeckList) {
  const stateRef = useRef<BattleState | null>(null);
  if (stateRef.current === null) {
    stateRef.current = createBattle([playerDeck, enemyDeck], Math.floor(Math.random() * 1e9));
  }
  const state = stateRef.current;

  const [version, setVersion] = useState(0);
  const [queue, setQueue] = useState<NarrEvent[]>([]);
  const [current, setCurrent] = useState<NarrEvent | null>(null);
  const [pops, setPops] = useState<DamagePop[]>([]);
  const [koShown, setKoShown] = useState<Set<string>>(new Set());
  const aiRef = useRef<BattleAi>(simpleAi({ keepHand: 2 }));

  const busy = queue.length > 0 || current !== null;

  /** 開幕処理（先攻決定・クラウディア等）のログも再生する */
  const bootRef = useRef(false);
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    const s = stateRef.current!;
    const events = s.log.map((l) => classify(s, l, s.firstPlayer)).filter((e): e is NarrEvent => e !== null);
    setQueue(events);
  }, []);

  /** 行動を適用し、新しく起きたことを演出キューへ */
  const perform = useCallback((action: BattleAction) => {
    const s = stateRef.current!;
    const who = actingPlayer(s) as 0 | 1;
    const seqBefore = s.logSeq;

    applyAction(s, action);

    const newCount = s.logSeq - seqBefore;
    const newLines = newCount > 0 ? s.log.slice(-Math.min(newCount, s.log.length)) : [];
    const events = newLines.map((l) => classify(s, l, who)).filter((e): e is NarrEvent => e !== null);
    setQueue((q) => [...q, ...events]);
    setVersion((v) => v + 1);
  }, []);

  // 演出キューの再生ループ
  useEffect(() => {
    if (current !== null) return; // 再生中
    if (queue.length === 0) {
      // 再生し終わったら、戦闘不能の表示をエンジンの状態と同期させる（取りこぼし防止）
      const s = stateRef.current!;
      setKoShown((prev) => {
        const next = new Set<string>();
        s.players.forEach((p, si) =>
          p.characters.forEach((_, ci) => {
            if (!isCharAlive(s, si as 0 | 1, ci)) next.add(`${si}-${ci}`);
          }),
        );
        // 再生済みの分も維持（同期と同じ内容になるはず）
        prev.forEach((k) => next.add(k));
        return next;
      });
      return;
    }
    const ev = queue[0];
    setQueue((q) => q.slice(1));
    setCurrent(ev);

    // イベントに応じた演出の発火
    if ((ev.kind === 'damage' || ev.kind === 'heal') && ev.side !== undefined && ev.charIndex !== undefined) {
      const pop: DamagePop = {
        key: uniq++,
        side: ev.side,
        charIndex: ev.charIndex,
        amount: ev.kind === 'damage' ? (ev.amount ?? 0) : -(ev.amount ?? 0),
      };
      setPops((prev) => [...prev, pop]);
      window.setTimeout(() => setPops((prev) => prev.filter((p) => p.key !== pop.key)), 1100);
    }
    if (ev.kind === 'ko' && ev.side !== undefined && ev.charIndex !== undefined) {
      const key = `${ev.side}-${ev.charIndex}`;
      window.setTimeout(() => setKoShown((prev) => new Set(prev).add(key)), 300);
    }
    if (ev.kind === 'revive' && ev.side !== undefined && ev.charIndex !== undefined) {
      const key = `${ev.side}-${ev.charIndex}`;
      setKoShown((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }

    window.setTimeout(() => setCurrent(null), ev.duration);
  }, [queue, current]);

  // AIの手番（演出が終わってから考える）
  useEffect(() => {
    const s = stateRef.current!;
    if (busy || s.phase === 'finished') return;
    if (actingPlayer(s) !== ENEMY) return;
    const timer = window.setTimeout(() => {
      const s2 = stateRef.current!;
      if (s2.phase === 'finished' || actingPlayer(s2) !== ENEMY) return;
      perform(aiRef.current.choose(s2, ENEMY));
    }, AI_THINK_MS);
    return () => window.clearTimeout(timer);
  }, [version, busy, perform]);

  return {
    state,
    version,
    busy,
    current,
    pops,
    koShown,
    perform,
    myActions: !busy && actingPlayer(state) === PLAYER ? legalActions(state) : [],
    isMyTurn: actingPlayer(state) === PLAYER,
  };
}
