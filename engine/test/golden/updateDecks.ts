/**
 * golden deck（スタンダードデッキ8種の確定内容）を作り直す。
 *
 *   npm --workspace engine run golden:decks
 *
 * プリセットを組み替えたら、変更が意図したものであることを確かめてから実行し、
 * 差分を目で見てからコミットすること。テストを通すために機械的に走らせない。
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkDeckLegality } from '../../src/deckLegality';
import { DEFAULT_FORMAT, formatVersionId } from '../../src/formats';
import { sampleArchetypeDecks } from '../../src/sampleDecks';
import { CONTENT_MANIFEST } from '../../src/versions';

const here = dirname(fileURLToPath(import.meta.url));

const decks = sampleArchetypeDecks().map((named) => {
  const legality = checkDeckLegality(named.deck, DEFAULT_FORMAT);
  if (!legality.legal) {
    throw new Error(`「${named.name}」が${formatVersionId(DEFAULT_FORMAT)}で不正です`);
  }
  return {
    name: named.name,
    concept: named.concept,
    characterIds: named.deck.characterIds,
    cardIds: named.deck.cardIds,
  };
});

const golden = {
  _comment:
    'スタンダードデッキ8種の確定内容。プリセットを直すと差分が出るので、意図した変更かを必ず確認する。作り直しは npm --workspace engine run golden:decks。',
  contentVersion: CONTENT_MANIFEST.contentVersion,
  formatVersionId: formatVersionId(DEFAULT_FORMAT),
  decks,
};

writeFileSync(join(here, 'decks.json'), `${JSON.stringify(golden, null, 2)}\n`);

console.log(`golden deck ${decks.length}種を書き出しました（${golden.formatVersionId} / ${golden.contentVersion}）`);
for (const deck of decks) {
  console.log(`  ${deck.name}: キャラ${deck.characterIds.length} / ${deck.cardIds.length}枚`);
}
