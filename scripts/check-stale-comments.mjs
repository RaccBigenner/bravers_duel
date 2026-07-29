#!/usr/bin/env node
/**
 * 古くなった記述（stale comment）の検査。
 *
 *   npm run check:stale
 *
 * 直したはずのルールがコメントや文書に残っていると、次に読む人がそれを信じて間違える。
 * 人が気をつけるのではなく、機械で落とす。
 *
 * 検査するもの:
 *   A. 実在しないファイルへの参照（リファクタで移動・削除したのに参照が残っている）
 *   B. 古い決定が残った言い回し（下の FORBIDDEN_PHRASES）
 *   C. README に書いた npm コマンドが package.json に無い／「準備中」なのに動く
 *
 * 例外の作り方（どちらも理由を一緒に書くこと）:
 *   - 1行だけ除く: その行へ `stale-ok` と書く
 *   - 節ごと除く: Markdownの見出しへ `<!-- stale-ok: 履歴 -->` と書く。
 *     同じ深さ以上の次の見出しまでが対象。「決定の記録」「変更の記録」など、
 *     当時のまま残すべき履歴はこれで現行の記述と区別する。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 検査対象にする拡張子 */
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.mts', '.md', '.json']);

/** 中を見ないフォルダ・ファイル */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'archive', 'assets', '.vite']);
const SKIP_FILES = new Set(['package-lock.json']);

/**
 * 古い決定が残った言い回し。ルールを変えたらここへ足す。
 * `why` には「今はどうなのか」を書く（読んだ人がすぐ直せるように）。
 */
export const FORBIDDEN_PHRASES = [
  {
    pattern: /(?:デッキ|山札)は?50枚|50枚(?:ちょうど|構築)/,
    why: '40枚側は40枚（2026-07-23 社長決定で50→40に戻した）',
  },
  {
    pattern: /同名(?:カード)?(?:は)?3枚まで/,
    why: '40枚側の同名上限は4枚（2026-07-22 社長決定で3→4）',
  },
  {
    pattern: /キャラクター(?:枠)?は?(?:1〜3|1～3)枚/,
    why: 'キャラクター枠は3枠ちょうど（大型は2枠）。OLG-001で確定',
  },
  {
    pattern: /oracle\s*ID?を(?:今後|あとで|将来)分離/i,
    why: 'oracleId と printingId の分離は OLG-003 で完了済み',
  },
];

function listFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || SKIP_FILES.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) listFiles(full, out);
    else if (SCAN_EXTENSIONS.has(extname(name))) out.push(full);
  }
  return out;
}

/** 検査対象のファイル一覧（リポジトリ相対） */
export function scanTargets(root = ROOT) {
  return listFiles(root).map((f) => relative(root, f));
}

/**
 * 履歴として当時のまま残す節を割り出す。
 * 見出しに `stale-ok` があれば、同じ深さ以上の次の見出しの手前までを対象外にする。
 */
export function exemptLines(text) {
  const lines = text.split('\n');
  const exempt = new Set();
  let depth = null;
  lines.forEach((line, i) => {
    const heading = line.match(/^(#{1,6})\s/);
    if (heading) {
      const level = heading[1].length;
      if (depth !== null && level <= depth) depth = null;
      if (line.includes('stale-ok')) depth = level;
    }
    if (depth !== null) exempt.add(i);
  });
  return exempt;
}

/** その行を検査しないか（行の印・節の印） */
function isExempt(line, index, exempt) {
  return line.includes('stale-ok') || exempt.has(index);
}

const TOP_DIRS = 'admin|assets|data|docs|engine|ops|scripts|tools|web';
const REF_RE = new RegExp(
  `(?<![\\w./@-])(?:${TOP_DIRS})/[\\w./-]*\\.(?:ts|tsx|mjs|mts|json|md|yml|yaml|png|webp)\\b`,
  'g',
);

/** テストは「まだ無いファイル」を題材にしてよいので、ファイル参照の検査から外す */
function isTestFile(file) {
  return /\.test\.(ts|tsx|mjs|mts)$/.test(file);
}

/** A. 実在しないファイルへの参照 */
export function findDeadFileReferences(files, root = ROOT) {
  const problems = [];
  for (const file of files) {
    if (isTestFile(file)) continue;
    const text = readFileSync(join(root, file), 'utf8');
    const exempt = exemptLines(text);
    text.split('\n').forEach((line, i) => {
      if (isExempt(line, i, exempt)) return;
      for (const ref of line.match(REF_RE) ?? []) {
        // ワイルドカード・テンプレート変数・`volN` のような雛形は対象外
        if (ref.includes('*') || ref.includes('${') || ref.includes('node_modules')) continue;
        if (/\bvolN\b/.test(ref)) continue;
        if (existsSync(join(root, ref))) continue;
        problems.push({
          rule: 'dead-file-reference',
          file,
          line: i + 1,
          detail: `存在しないファイルを指しています: ${ref}`,
        });
      }
    });
  }
  return problems;
}

/** B. 古い決定が残った言い回し */
export function findForbiddenPhrases(files, root = ROOT, phrases = FORBIDDEN_PHRASES) {
  const problems = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    const exempt = exemptLines(text);
    text.split('\n').forEach((line, i) => {
      if (isExempt(line, i, exempt)) return;
      for (const { pattern, why } of phrases) {
        if (pattern.test(line)) {
          problems.push({
            rule: 'forbidden-phrase',
            file,
            line: i + 1,
            detail: `古い記述が残っています: 「${line.trim().slice(0, 60)}」→ ${why}`,
          });
        }
      }
    });
  }
  return problems;
}

/** C. README に書いた npm コマンドが実在するか、「準備中」が嘘になっていないか */
export function checkReadmeCommands(readmeText, scripts) {
  const problems = [];
  readmeText.split('\n').forEach((line, i) => {
    if (line.includes('stale-ok')) return;
    const match = line.match(/npm run ([\w:]+)/);
    if (!match) return;
    const name = match[1];
    if (!(name in scripts)) {
      problems.push({
        rule: 'readme-command',
        file: 'README.md',
        line: i + 1,
        detail: `package.json に無いコマンドを書いています: npm run ${name}`,
      });
      return;
    }
    if (/準備中|未実装/.test(line)) {
      problems.push({
        rule: 'readme-command',
        file: 'README.md',
        line: i + 1,
        detail: `npm run ${name} は動くのに「準備中」と書いてあります`,
      });
    }
  });
  return problems;
}

export function runChecks(root = ROOT) {
  const files = scanTargets(root);
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {};
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  return [
    ...findDeadFileReferences(files, root),
    ...findForbiddenPhrases(files, root),
    ...checkReadmeCommands(readme, scripts),
  ];
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const problems = runChecks();
  if (problems.length === 0) {
    console.log(`✓ 古くなった記述なし（${scanTargets().length}ファイルを検査）`);
    process.exit(0);
  }
  console.error(`✗ 古くなった記述が ${problems.length} 件あります\n`);
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}  [${p.rule}]`);
    console.error(`    ${p.detail}`);
  }
  console.error('\n直すか、意図的に残すなら該当行へ `stale-ok` と理由を書いてください。');
  process.exit(1);
}
