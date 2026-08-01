import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ADAPTER_PATH = 'server/src/battle/engineBattleAdapter.ts';
const SERVER_SOURCE_EXTENSION = /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/u;

async function typescriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return typescriptFiles(target);
      return entry.isFile() && SERVER_SOURCE_EXTENSION.test(entry.name)
        ? [target]
        : [];
    }),
  );
  return nested.flat();
}

function normalized(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function scriptKind(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function literalText(expression) {
  return expression && ts.isStringLiteralLike(expression)
    ? expression.text
    : null;
}

function unwrappedCallee(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isPartiallyEmittedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function engineReferenceViolation(file, specifier) {
  const portableSpecifier = specifier.replaceAll('\\', '/');
  if (portableSpecifier === '@bravers/engine') {
    return file === ADAPTER_PATH
      ? null
      : `${file}: @bravers/engine は ${ADAPTER_PATH} からだけimportできる`;
  }

  const segments = portableSpecifier.split('/');
  const isDeepPackageImport = portableSpecifier.startsWith('@bravers/engine/');
  const isEngineSourceImport = segments.some(
    (segment, index) => segment === 'engine' && segments[index + 1] === 'src',
  );
  const isRelativeEngineImport =
    /^\.{1,2}\//u.test(portableSpecifier) && segments.includes('engine');

  return isDeepPackageImport || isEngineSourceImport || isRelativeEngineImport
    ? `${file}: engine内部importは禁止: ${specifier}`
    : null;
}

function nonLiteralViolation(file, kind) {
  return `${file}: 非literalな${kind}は禁止`;
}

export function serverEngineBoundaryViolations(relativePath, source) {
  const file = normalized(relativePath);
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const violations = sourceFile.parseDiagnostics.map((diagnostic) => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      diagnostic.start ?? 0,
    );
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    return `${file}:${line + 1}:${character + 1}: 構文解析失敗: ${message}`;
  });

  function recordLiteral(specifier) {
    const violation = engineReferenceViolation(file, specifier);
    if (violation) violations.push(violation);
  }

  function recordExpression(expression, kind) {
    const specifier = literalText(expression);
    if (specifier === null) {
      violations.push(nonLiteralViolation(file, kind));
      return;
    }
    recordLiteral(specifier);
  }

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      recordExpression(node.moduleSpecifier, 'import');
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      recordExpression(node.moduleSpecifier, 'export from');
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      recordExpression(node.moduleReference.expression, 'import = require');
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument)) {
        recordExpression(argument.literal, 'import type');
      } else {
        violations.push(nonLiteralViolation(file, 'import type'));
      }
    } else if (ts.isCallExpression(node)) {
      const callee = unwrappedCallee(node.expression);
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        recordExpression(node.arguments[0], 'dynamic import');
      } else if (ts.isIdentifier(callee) && callee.text === 'require') {
        recordExpression(node.arguments[0], 'require');
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

export async function checkServerEngineBoundary(projectRoot) {
  const sourceRoot = path.join(projectRoot, 'server', 'src');
  const files = await typescriptFiles(sourceRoot);
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    violations.push(
      ...serverEngineBoundaryViolations(path.relative(projectRoot, file), source),
    );
  }
  return { checkedFiles: files.length, violations };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await checkServerEngineBoundary(projectRoot);
  if (result.violations.length > 0) {
    for (const violation of result.violations) console.error(violation);
    process.exitCode = 1;
  } else {
    console.log(`server engine boundary: ${result.checkedFiles} files clean`);
  }
}
