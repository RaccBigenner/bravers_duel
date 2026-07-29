#!/usr/bin/env node
/**
 * ローカルテスト用の入口。
 *
 * 公開処理本体は非公開WIPリポへ同期するopsテンプレートを正本にする。
 * Actionsは公開リポのコードを未公開データと同じ権限で実行しない。
 */
export * from '../ops/bravers_duel_wip/.github/scripts/publish-card-set.mjs';
import { main } from '../ops/bravers_duel_wip/.github/scripts/publish-card-set.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const entryPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (import.meta.url === entryPath) {
  process.exitCode = await main();
}
