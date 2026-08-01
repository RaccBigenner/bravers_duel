import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkServerEngineBoundary,
  serverEngineBoundaryViolations,
} from './check-server-engine-boundary.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootImportViolation =
  'server/src/other.ts: @bravers/engine は server/src/battle/engineBattleAdapter.ts からだけimportできる';

test('server本体は専用adapterのpackage root importだけを許す', async () => {
  const result = await checkServerEngineBoundary(projectRoot);
  assert.deepEqual(result.violations, []);
  assert.ok(result.checkedFiles > 0);
});

test('TypeScript ASTですべてのmodule参照形式を検出する', () => {
  const forbiddenSources = [
    `import { createBattle } from '@bravers/engine';`,
    `import '@bravers/engine';`,
    `export { createBattle } from '@bravers/engine';`,
    `export * from '@bravers/engine';`,
    `import engine = require('@bravers/engine');`,
    `const engine = import /* comment */ ('@bravers/engine');`,
    `const engine = require /* comment */ ('@bravers/engine');`,
    `type Engine = import('@bravers/engine').Engine;`,
  ];

  for (const source of forbiddenSources) {
    assert.deepEqual(
      serverEngineBoundaryViolations('server/src/other.ts', source),
      [rootImportViolation],
      source,
    );
  }
});

test('adapterだけはexact package root参照を許し、deep/relative参照を拒否する', () => {
  const adapterPath = 'server/src/battle/engineBattleAdapter.ts';
  assert.deepEqual(
    serverEngineBoundaryViolations(
      adapterPath,
      `import { createBattle } from '@bravers/engine';`,
    ),
    [],
  );

  for (const specifier of [
    '@bravers/engine/battle',
    '../../../engine/src/index.ts',
    '../../engine/private.ts',
  ]) {
    assert.deepEqual(
      serverEngineBoundaryViolations(
        adapterPath,
        `const engine = import(${JSON.stringify(specifier)});`,
      ),
      [`${adapterPath}: engine内部importは禁止: ${specifier}`],
      specifier,
    );
  }

  assert.deepEqual(
    serverEngineBoundaryViolations(
      adapterPath,
      `import helper from '../../my-engine/helper.ts';`,
    ),
    [],
  );
});

test('非literalなdynamic importとrequireをfail closedで拒否する', () => {
  const cases = [
    [`const engine = import(moduleName);`, 'dynamic import'],
    [`const engine = import(` + '`@bravers/${part}`' + `);`, 'dynamic import'],
    [`const engine = require(moduleName);`, 'require'],
    [`const engine = (require as NodeRequire)(moduleName);`, 'require'],
    [`const engine = require();`, 'require'],
  ];

  for (const [source, kind] of cases) {
    assert.deepEqual(
      serverEngineBoundaryViolations('server/src/other.ts', source),
      [`server/src/other.ts: 非literalな${kind}は禁止`],
      source,
    );
  }

  assert.deepEqual(
    serverEngineBoundaryViolations(
      'server/src/other.ts',
      "const fs = require(`node:fs`);",
    ),
    [],
  );
});

test('TypeScriptとJavaScriptの全server source拡張子を再帰走査する', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'engine-boundary-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourceRoot = path.join(temporaryRoot, 'server', 'src', 'nested');
  await mkdir(sourceRoot, { recursive: true });

  const forbiddenImport = `import '@bravers/engine';`;
  const extensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
  await Promise.all(
    extensions.map((extension) =>
      writeFile(path.join(sourceRoot, `sample${extension}`), forbiddenImport),
    ),
  );
  await writeFile(path.join(sourceRoot, 'ignored.txt'), forbiddenImport);

  const result = await checkServerEngineBoundary(temporaryRoot);
  assert.equal(result.checkedFiles, extensions.length);
  assert.equal(result.violations.length, extensions.length);
  for (const extension of extensions) {
    assert.ok(
      result.violations.some((violation) =>
        violation.startsWith(`server/src/nested/sample${extension}:`),
      ),
      extension,
    );
  }
});
