/**
 * バトル画面の状態管理フック。
 * エンジンの BattleState を保持し、AIの手番を自動で進め、
 * 演出用のイベント（ダメージ・カード公開など）を発行する。
 */
import {
  actingPlayer,
  applyAction,
  createBattle,
  legalActions,
  simpleAi,
  type BattleAction,
  type BattleAi,
  type BattleState,
  type Card,
  type DeckList,
  cardById,
} from '@bravers/engine';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface DamagePop {
  key: number;
  side: 0 | 1;
  charIndex: number;
  amount: number; // マイナスなら回復
}

export interface Reveal {
  key: number;
  card: Card;
  side: 0 | 1; // 使ったのはどちらか
  label?: string;
}

const AI_STEP_MS = 900;
const PLAYER = 0 as const;
const ENEMY = 1 as const;

let uniq = 1;

export function useBattle(playerDeck: DeckList, enemyDeck: DeckList) {
  const stateRef = useRef<BattleState | null>(null);
  if (stateRef.current === null) {
    stateRef.current = createBattle([playerDeck, enemyDeck], Math.floor(Math.random() * 1e9));
  }
  const [version, setVersion] = useState(0);
  const [pops, setPops] = useState<DamagePop[]>([]);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const aiRef = useRef<BattleAi>(simpleAi({ keepHand: 2 }));

  const state = stateRef.current;

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  /** 行動を適用し、状態差分から演出イベントを作る */
  const perform = useCallback(
    (action: BattleAction) => {
      const s = stateRef.current!;
      const who = actingPlayer(s);

      // 差分検出用スナップショット
      const before = s.players.map((p) => p.characters.map((c) => c.damage));

      // カード公開演出（プレイ系の行動）
      if (action.type === 'playSkill' || action.type === 'playGuard' || action.type === 'playCharacter'
        || action.type === 'playEquipment' || action.type === 'playField') {
        const id = s.players[who].hand[action.handIndex];
        if (id) {
          const label = action.type === 'playGuard' ? 'ガード！' : undefined;
          setReveal({ key: uniq++, card: cardById(id), side: who as 0 | 1, label });
          window.setTimeout(() => setReveal((r) => (r && r.card.id === id ? null : r)), 1100);
        }
      }

      applyAction(s, action);

      // ダメージ・回復のポップ
      const newPops: DamagePop[] = [];
      s.players.forEach((p, si) => {
        p.characters.forEach((c, ci) => {
          const diff = c.damage - before[si][ci];
          if (diff !== 0) {
            newPops.push({ key: uniq++, side: si as 0 | 1, charIndex: ci, amount: diff });
          }
        });
      });
      if (newPops.length > 0) {
        setPops((prev) => [...prev, ...newPops]);
        window.setTimeout(() => {
          setPops((prev) => prev.filter((p) => !newPops.includes(p)));
        }, 1200);
      }
      bump();
    },
    [bump],
  );

  // AIの手番を自動で進める
  useEffect(() => {
    const s = stateRef.current!;
    if (s.phase === 'finished') return;
    if (actingPlayer(s) !== ENEMY) return;
    const timer = window.setTimeout(() => {
      const s2 = stateRef.current!;
      if (s2.phase === 'finished' || actingPlayer(s2) !== ENEMY) return;
      const action = aiRef.current.choose(s2, ENEMY);
      perform(action);
    }, AI_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [version, perform]);

  return {
    state,
    version,
    pops,
    reveal,
    perform,
    myActions: actingPlayer(state) === PLAYER ? legalActions(state) : [],
    isMyTurn: actingPlayer(state) === PLAYER,
  };
}
