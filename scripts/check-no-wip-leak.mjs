/**
 * 公開ビルド(web/dist)に、未公開の弾の情報が混入していないかを検査する最終防波堤。
 *
 * engine 側のゲート（released の弾だけを ALL_CARDS に入れる）で普通は防げるが、
 * 万一 data/cards.json への誤混入や import ミスがあっても、ここで実バンドルを
 * 文字列走査して未公開のテーマ名・コードネーム・制作中カード名を見つけたら CI を落とす。
 *
 * 使い方: npm run build のあとに `node scripts/check-no-wip-leak.mjs`
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 公開ビルドに出てはいけない文字列を集める */
function collectSecrets() {
  const secrets = new Set();
  const sets = JSON.parse(readFileSync(resolve(REPO, 'data/sets.json'), 'utf8')).sets ?? [];
  for (const s of sets) {
    if (s.status === 'released') continue;
    for (const key of ['themeName', 'themeSubtitle', 'codename']) {
      if (s[key]) secrets.add(s[key]);
    }
  }
  // ローカルに制作中カード(data/wip)があれば、その名前も漏れ検査に含める
  // （CIのクリーンチェックアウトには存在しないので実質ローカル用）
  const wipDir = resolve(REPO, 'data/wip');
  if (existsSync(wipDir)) {
    for (const f of readdirSync(wipDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(readFileSync(resolve(wipDir, f), 'utf8'));
        const cards = Array.isArray(parsed) ? parsed : (parsed.cards ?? []);
        for (const c of cards) if (c.name) secrets.add(c.name);
      } catch {
        /* 壊れた WIP ファイルは無視 */
      }
    }
  }
  return [...secrets];
}

const secrets = collectSecrets();
if (secrets.length === 0) {
  console.log('✓ 未公開の弾はありません。漏れ検査は不要です。');
  process.exit(0);
}

const distDir = resolve(REPO, 'web/dist/assets');
if (!existsSync(distDir)) {
  console.error('web/dist/assets が見つかりません。先に `npm run build` を実行してください。');
  process.exit(1);
}

const bundle = readdirSync(distDir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(resolve(distDir, f), 'utf8'))
  .join('\n');

const leaked = secrets.filter((s) => bundle.includes(s));
if (leaked.length > 0) {
  console.error('❌ 未公開の弾の情報が公開ビルドに混入しています:');
  for (const s of leaked) console.error(`   - "${s}"`);
  console.error('data/cards.json に制作中カードを入れていないか、import 経路を確認してください。');
  process.exit(1);
}

console.log(`✓ 未公開弾の漏れなし（${secrets.length}件の秘匿文字列を検査）`);
