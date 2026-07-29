/**
 * golden replay の入力条件。
 * 生成スクリプト（update.ts）とテスト（replay.test.ts）が同じ値を見るように、ここへ固定する。
 */
export const GOLDEN_REPLAY_SETUP = {
  seed: 20260729,
  firstPlayer: 0 as const,
  /** sampleArchetypeDecks() の名前で指定する */
  deckNames: ['剣聖の一閃', '魔王の柩'] as const,
};
