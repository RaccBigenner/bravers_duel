/**
 * golden replay を作り直す。
 *
 *   npm --workspace engine run golden:update
 *
 * ルールを直したら、その変更が意図したものであることを確かめたうえで実行し、
 * 差分を必ず目で見てからコミットすること。テストを通すために機械的に走らせない。
 * engine の挙動が変わったのに `ENGINE_VERSION` を上げ忘れていないかも同時に確認する。
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { simpleAi } from '../../src/ai';
import { sampleArchetypeDecks } from '../../src/sampleDecks';
import { recordBattle } from '../../src/replay';
import { ENGINE_VERSION, CONTENT_MANIFEST } from '../../src/versions';
import { GOLDEN_REPLAY_SETUP } from './setup';

const here = dirname(fileURLToPath(import.meta.url));

const decks = sampleArchetypeDecks();
const p0 = decks.find((d) => d.name === GOLDEN_REPLAY_SETUP.deckNames[0]);
const p1 = decks.find((d) => d.name === GOLDEN_REPLAY_SETUP.deckNames[1]);
if (!p0 || !p1) {
  throw new Error(`golden replay 用のプリセットが見つかりません: ${GOLDEN_REPLAY_SETUP.deckNames.join(' / ')}`);
}

const { replay } = recordBattle([p0.deck, p1.deck], [simpleAi(), simpleAi()], GOLDEN_REPLAY_SETUP.seed, {
  firstPlayer: GOLDEN_REPLAY_SETUP.firstPlayer,
});

writeFileSync(join(here, 'replay.json'), `${JSON.stringify(replay, null, 2)}\n`);

console.log('golden replay を書き出しました');
console.log(`  engineVersion : ${ENGINE_VERSION}`);
console.log(`  contentVersion: ${CONTENT_MANIFEST.contentVersion}（公開カード${CONTENT_MANIFEST.cardCount}枚 / 弾${CONTENT_MANIFEST.setCount}）`);
console.log(`  format        : ${replay.header.formatVersionId}`);
console.log(`  手数          : ${replay.commands.length}`);
console.log(`  結果          : winner=${replay.result.winner} reason=${replay.result.endReason} turns=${replay.result.turns}`);
