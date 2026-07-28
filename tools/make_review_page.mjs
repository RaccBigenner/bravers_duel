/**
 * 生成した絵の確認ページを作る。
 *   node tools/make_review_page.mjs <画像フォルダ>
 * 出力: <画像フォルダ>/index.html （ブラウザで開いて、今の絵と並べて見る）
 */
import { readFileSync, writeFileSync, readdirSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('画像フォルダを指定してください');
  process.exit(1);
}
const cards = JSON.parse(readFileSync('data/cards.json', 'utf8'));
const briefs = JSON.parse(readFileSync(process.argv[3] ?? 'tools/skill_art_briefs.json', 'utf8'));
const byId = Object.fromEntries(cards.map((c) => [c.id, c]));

const ids = readdirSync(dir)
  .filter((f) => f.endsWith('.webp') && !f.startsWith('old_'))
  .map((f) => basename(f, '.webp'))
  .sort();

// 比較用に「いまの絵」を並べて置く
mkdirSync(`${dir}/old`, { recursive: true });
for (const id of ids) {
  const src = `assets/card_images/${id}.webp`;
  if (existsSync(src)) copyFileSync(src, `${dir}/old/${id}.webp`);
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const rows = ids
  .map((id) => {
    const c = byId[id] ?? {};
    const b = briefs[id] ?? {};
    const cast = (b.cast || []).join('・');
    return `
<section>
  <h2>${esc(c.name)} <small>${esc(id)}／${esc(c.rarity)}／AP${esc(c.costAp)}／${esc((c.conditionAttribute || []).join('・'))}${cast ? `／使い手: ${esc(cast)}` : ''}</small></h2>
  <p class="memo">${esc(b.memo)}</p>
  <div class="pair">
    <figure class="old"><img src="old/${id}.webp" loading="lazy"><figcaption>いまの絵</figcaption></figure>
    <figure><img src="${id}.webp" loading="lazy"><figcaption>新しい絵</figcaption></figure>
  </div>
</section>`;
  })
  .join('\n');

writeFileSync(
  `${dir}/index.html`,
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>スキル絵 確認</title><style>
body{background:#14161a;color:#e8e8e8;font-family:-apple-system,"Hiragino Sans",sans-serif;margin:0;padding:20px 20px 60px;}
h1{font-size:19px;margin:0 0 4px}
p.lead{color:#9aa0a8;font-size:13px;margin:0 0 20px}
section{border-top:1px solid #2a2f37;padding:16px 0}
h2{font-size:16px;margin:0 0 4px}
h2 small{font-weight:400;color:#8b929c;font-size:12px;margin-left:8px}
p.memo{color:#a8b4c4;font-size:13px;margin:0 0 10px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}
figure{margin:0}
figure img{width:100%;aspect-ratio:3/2;object-fit:contain;border-radius:6px;display:block;background:#000}
figcaption{font-size:11px;color:#7b828c;margin-top:4px}
</style></head><body>
<h1>スキルカードの絵 確認</h1>
<p class="lead">左が小さく薄いのが「いまの絵」、右の大きいのが「新しい絵」です。直したい番号を言ってください。</p>
${rows}
</body></html>`,
);
console.log(`${dir}/index.html （${ids.length}枚）`);
