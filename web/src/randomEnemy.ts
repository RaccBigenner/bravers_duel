/**
 * 「敵はランダム」を選んだときの抽選。
 *
 * バトル準備画面と「もう一回」の両方から使う。片方だけで抽選していると
 * リマッチのたびに同じ敵が出続けて「ランダムが効いていない」ように見える。
 */
import { sampleArchetypeDecks, type NamedDeck } from '@bravers/engine';

/**
 * スタンダードデッキから1つ選ぶ。excludeNames と同じ名前のデッキは候補から外す
 * （自分と同じデッキ＝ミラー、および直前と同じ相手を避けるため）。
 * 全部除外されてしまう場合は、除外を諦めて全体から選ぶ。
 */
export function rollEnemy(excludeNames: string[] = []): NamedDeck {
  const all = sampleArchetypeDecks();
  const pool = all.filter((d) => !excludeNames.includes(d.name));
  const from = pool.length > 0 ? pool : all;
  return from[Math.floor(Math.random() * from.length)];
}

/** そのセットアップで「敵の抽選から外すべき名前」。プリセット使用時だけ自分のデッキ名を外す */
export function excludeForPlayer(playerDeckKind: string, playerDeckName: string): string[] {
  // カスタム/読み込みデッキは、たまたま名前がプリセットと同じでも中身は別物なので外さない
  return playerDeckKind === 'preset' ? [playerDeckName] : [];
}
