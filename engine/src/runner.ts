/**
 * 1回のバトルをAI同士で最後まで回す。
 */
import {
  actingPlayer,
  applyAction,
  createBattle,
  type BattleState,
  type EndReason,
  type PlayerIndex,
} from './battle';
import type { BattleAi } from './ai';
import type { DeckList, DeckRules } from './decks';

export interface BattleResult {
  winner: PlayerIndex | null;
  reason: EndReason;
  turns: number;
  firstPlayer: PlayerIndex;
  state: BattleState;
}

export interface RunBattleOptions {
  maxTurns?: number; // これを超えたら引き分け扱い
  firstPlayer?: PlayerIndex;
  deckRules?: DeckRules;
}

export function runBattle(
  decks: [DeckList, DeckList],
  ais: [BattleAi, BattleAi],
  seed: number,
  options: RunBattleOptions = {},
): BattleResult {
  const maxTurns = options.maxTurns ?? 200;
  const state = createBattle(decks, seed, { firstPlayer: options.firstPlayer, deckRules: options.deckRules });

  let safety = 0;
  while (state.phase !== 'finished') {
    if (state.turn > maxTurns) {
      state.phase = 'finished';
      state.winner = null;
      state.endReason = 'turnLimit';
      break;
    }
    if (++safety > 100000) {
      throw new Error('バトルが終わりません（AIが進行しない行動を選び続けています）');
    }
    // guardフェーズでは攻撃されている側のAIが行動を選ぶ
    const who = actingPlayer(state);
    const action = ais[who].choose(state, who);
    applyAction(state, action);
  }

  return {
    winner: state.winner,
    reason: state.endReason ?? 'turnLimit',
    turns: state.turn,
    firstPlayer: state.firstPlayer,
    state,
  };
}
