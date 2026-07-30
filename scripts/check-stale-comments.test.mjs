/**
 * 古くなった記述の検査（check-stale-comments.mjs）のテスト。
 * 検査そのものが壊れると、古い記述が素通りしてしまうため。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FORBIDDEN_PHRASES,
  checkReadmeCommands,
  exemptLines,
  findDeadFileReferences,
  findForbiddenPhrases,
  runChecks,
} from './check-stale-comments.mjs';

/** 検査用の小さなリポジトリを作る */
function makeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), 'stale-'));
  for (const [name, content] of Object.entries(files)) {
    const full = join(root, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

test('実在しないファイルへの参照を見つける', () => {
  const root = makeRepo({
    'docs/a.md': '仕様は engine/src/ghost.ts を見る\n',
    'engine/src/real.ts': '// ok\n',
  });
  const problems = findDeadFileReferences(['docs/a.md'], root);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].rule, 'dead-file-reference');
  assert.equal(problems[0].line, 1);
  assert.match(problems[0].detail, /engine\/src\/ghost\.ts/);
  rmSync(root, { recursive: true, force: true });
});

test('実在するファイルへの参照は通す', () => {
  const root = makeRepo({
    'docs/a.md': '実装は engine/src/real.ts にある\n',
    'engine/src/real.ts': '// ok\n',
  });
  assert.deepEqual(findDeadFileReferences(['docs/a.md'], root), []);
  rmSync(root, { recursive: true, force: true });
});

test('雛形（volN）とワイルドカードは対象外', () => {
  const root = makeRepo({
    'docs/a.md': '非公開の engine/src/effects/volN.ts と data/wip/*.json を用意する\n',
  });
  assert.deepEqual(findDeadFileReferences(['docs/a.md'], root), []);
  rmSync(root, { recursive: true, force: true });
});

test('テストファイルはファイル参照の検査から外す（架空の題材を書いてよい）', () => {
  const root = makeRepo({
    'engine/test/x.test.ts': "const path = 'engine/src/ghost.ts';\n",
  });
  assert.deepEqual(findDeadFileReferences(['engine/test/x.test.ts'], root), []);
  rmSync(root, { recursive: true, force: true });
});

// 以下は検査器そのものの題材なので、古い言い回しをわざと書いている。
// 各行の `stale-ok` は「検査対象から外す」印で、検査器の動きを試すためでもある。
test('古い決定が残った言い回しを見つける', () => {
  const root = makeRepo({ 'docs/a.md': 'デッキは50枚です\n' }); // stale-ok: 検査器の題材
  const problems = findForbiddenPhrases(['docs/a.md'], root);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].rule, 'forbidden-phrase');
  assert.match(problems[0].detail, /40枚/);
  rmSync(root, { recursive: true, force: true });
});

test('stale-ok と書いた行は見逃す', () => {
  const root = makeRepo({ 'docs/a.md': 'デッキは50枚です <!-- stale-ok: 当時の記録 -->\n' });
  assert.deepEqual(findForbiddenPhrases(['docs/a.md'], root), []);
  rmSync(root, { recursive: true, force: true });
});

test('見出しに stale-ok があれば、その節の中は見逃す', () => {
  const text = [
    '# タイトル',
    '現行: デッキは50枚です', // stale-ok: 検査器の題材
    '## 変更の記録 <!-- stale-ok: 履歴 -->',
    '昔はデッキは50枚でした', // stale-ok: 検査器の題材
    '## 次の節',
    'ここでデッキは50枚と書いたら怒られる', // stale-ok: 検査器の題材
  ].join('\n');
  const exempt = exemptLines(text);
  assert.equal(exempt.has(1), false, '現行の記述は対象');
  assert.equal(exempt.has(3), true, '履歴の節は対象外');
  assert.equal(exempt.has(5), false, '次の節へ入ったら再び対象');

  const root = makeRepo({ 'docs/a.md': `${text}\n` });
  const problems = findForbiddenPhrases(['docs/a.md'], root);
  assert.equal(problems.length, 2);
  assert.deepEqual(
    problems.map((p) => p.line),
    [2, 6],
  );
  rmSync(root, { recursive: true, force: true });
});

test('深い見出しで始めた履歴は、同じ深さ以上の見出しで終わる', () => {
  const text = ['### 履歴 <!-- stale-ok -->', 'デッキは50枚', '### 別の節', 'デッキは50枚'].join(
    '\n',
  );
  const exempt = exemptLines(text);
  assert.equal(exempt.has(1), true);
  assert.equal(exempt.has(3), false);
});

test('stale-ok節が入れ子でも、内側の見出しで外側の免除が縮まない', () => {
  const text = [
    '## 決定の記録 <!-- stale-ok -->', // 0
    'デッキは50枚', // 1: 親節の中（対象外） // stale-ok: 検査器の題材
    '### 2026-07-22 <!-- stale-ok -->', // 2: 子のstale-ok見出し
    'デッキは50枚', // 3: 子節の中（対象外） // stale-ok: 検査器の題材
    '### 2026-07-23', // 4: 子節は閉じたが、まだ親「決定の記録」の中
    'デッキは50枚', // 5: 親節の中のまま（対象外のはず） // stale-ok: 検査器の題材
    '## 次の節', // 6: 親も閉じる
    'デッキは50枚', // 7: 対象 // stale-ok: 検査器の題材
  ].join('\n');
  const exempt = exemptLines(text);
  assert.equal(exempt.has(1), true, '親節の直下');
  assert.equal(exempt.has(3), true, '入れ子の子節の中');
  assert.equal(exempt.has(5), true, '子節を出ても親節の中のまま');
  assert.equal(exempt.has(7), false, '親も閉じたら対象に戻る');
});

test('READMEに書いた npm コマンドが実在するか見る', () => {
  const problems = checkReadmeCommands('npm run nope   # 説明\n', { test: 'vitest' });
  assert.equal(problems.length, 1);
  assert.match(problems[0].detail, /package\.json に無い/);
});

test('動くコマンドを「準備中」と書いていたら見つける', () => {
  const problems = checkReadmeCommands('npm run sim   # 準備中\n', { sim: 'tsx' });
  assert.equal(problems.length, 1);
  assert.match(problems[0].detail, /準備中/);
});

test('実在するコマンドの普通の説明は通す', () => {
  assert.deepEqual(checkReadmeCommands('npm run sim   # 自動対戦\n', { sim: 'tsx' }), []);
});

test('npm --workspace 付きコマンドも実在を検査する', () => {
  const scripts = { test: 'vitest' };
  const workspaceScripts = { engine: { typecheck: 'tsc --noEmit' } };
  assert.deepEqual(
    checkReadmeCommands('npm --workspace engine run typecheck  # 型検査\n', scripts, workspaceScripts),
    [],
  );
  const problems = checkReadmeCommands(
    'npm --workspace engine run nope  # 説明\n',
    scripts,
    workspaceScripts,
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0].detail, /npm --workspace engine run nope/);
});

test('未知のワークスペース名は実在しないコマンド扱いにする', () => {
  const problems = checkReadmeCommands('npm --workspace ghost run test  # 説明\n', { test: 'vitest' }, {});
  assert.equal(problems.length, 1);
  assert.match(problems[0].detail, /package\.json に無い/);
});

test('1行に2つコマンドがあっても両方見る', () => {
  const problems = checkReadmeCommands(
    'npm run sim と npm run nope を使う\n',
    { sim: 'tsx' },
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0].detail, /npm run nope/);
});

test('禁止語の一覧は理由つきで書かれている', () => {
  assert.ok(FORBIDDEN_PHRASES.length > 0);
  for (const entry of FORBIDDEN_PHRASES) {
    assert.ok(entry.pattern instanceof RegExp);
    assert.ok(typeof entry.why === 'string' && entry.why.length > 0, '理由が要る');
  }
});

test('このリポジトリ自身に古くなった記述が無い', () => {
  assert.deepEqual(runChecks(), []);
});
