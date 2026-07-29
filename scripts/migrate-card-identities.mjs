#!/usr/bin/env node
/**
 * 旧カードマスターの `id` を、ルール上の同一性 `oracleId` と
 * 収録物の同一性 `printingId` へ一度だけ分離する。
 *
 * oracleIdの自動採番は「再録がまだ存在しない最初の弾」のbootstrapだけに限定する。
 * それ以外の弾は、再録元か新規カードかを機械判定できないためoracleIdを必須にする。
 *
 * Usage:
 *   node scripts/migrate-card-identities.mjs [--bootstrap-vol=1] data/cards.json [...]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const RARITIES = new Set(['C', 'UC', 'R', 'SR', 'SSR', 'USR', 'LSR']);

function cardArrayOf(parsed, label) {
  const cards = Array.isArray(parsed) ? parsed : parsed?.cards;
  if (!Array.isArray(cards)) throw new Error(`${label}: カード配列ではありません`);
  return cards;
}

export function migrateDocument(parsed, label, bootstrapVol = 1) {
  const cards = cardArrayOf(parsed, label);
  const migrated = cards.map((card, index) => {
    if (!card || typeof card !== 'object' || Array.isArray(card)) {
      throw new Error(`${label}[${index}]: カードオブジェクトではありません`);
    }
    if (
      card.id != null &&
      card.printingId != null &&
      card.id !== card.printingId
    ) {
      throw new Error(`${label}[${index}]: id と printingId が一致しません`);
    }
    const printingId = card.printingId ?? card.id;
    if (typeof printingId !== 'string' || printingId.trim() === '') {
      throw new Error(`${label}[${index}]: id / printingId がありません`);
    }
    if (
      typeof card.vol !== 'number' ||
      !Number.isInteger(card.vol) ||
      card.vol < 1 ||
      typeof card.code !== 'string' ||
      !/^A\d{3}$/.test(card.code) ||
      typeof card.rarity !== 'string' ||
      !RARITIES.has(card.rarity)
    ) {
      throw new Error(
        `${printingId}: volは正の整数、codeはA001形式、rarityは既知値で指定してください`,
      );
    }
    const expectedPrintingId = `${card.vol}-${card.code}-${card.rarity}`;
    if (printingId !== expectedPrintingId) {
      throw new Error(
        `${printingId}: printingId が vol-code-rarity と一致しません（期待: ${expectedPrintingId}）`,
      );
    }

    let oracleId = card.oracleId;
    if (oracleId == null || oracleId === '') {
      if (card.vol !== bootstrapVol) {
        throw new Error(
          `${printingId}: vol${bootstrapVol}以外はoracleIdを明示してください（再録元は自動判定できません）`,
        );
      }
      oracleId = `${card.vol}-${card.code}`;
    }
    if (typeof oracleId !== 'string' || oracleId.trim() === '') {
      throw new Error(`${printingId}: oracleId が不正です`);
    }
    if (oracleId !== oracleId.trim()) {
      throw new Error(`${printingId}: oracleId の前後に空白を含めないでください`);
    }

    const {
      id: _legacyId,
      oracleId: _oldOracleId,
      printingId: _oldPrintingId,
      ...rest
    } = card;
    return { oracleId, printingId, ...rest };
  });

  return Array.isArray(parsed) ? migrated : { ...parsed, cards: migrated };
}

export function validateDocuments(documents) {
  const locations = new Map();
  for (const { label, parsed } of documents) {
    for (const [index, card] of cardArrayOf(parsed, label).entries()) {
      const previous = locations.get(card.printingId);
      if (previous) {
        throw new Error(
          `printingId が入力ファイル間で重複しています: ${card.printingId} (${previous}, ${label}[${index}])`,
        );
      }
      locations.set(card.printingId, `${label}[${index}]`);
    }
  }
}

export async function main(argv) {
  const option = argv.find((arg) => arg.startsWith('--bootstrap-vol='));
  const bootstrapVol = option
    ? Number(option.slice('--bootstrap-vol='.length))
    : 1;
  if (!Number.isInteger(bootstrapVol) || bootstrapVol < 1) {
    throw new Error('--bootstrap-vol は1以上の整数で指定してください');
  }
  const inputs = argv.filter((arg) => !arg.startsWith('--'));
  if (inputs.length === 0) {
    throw new Error('移行するカードJSONのパスを1つ以上指定してください。');
  }

  // 全入力を先に読み、全件検証が成功するまで1ファイルも書き換えない。
  const documents = await Promise.all(
    inputs.map(async (input) => {
      const path = resolve(input);
      const source = JSON.parse(await readFile(path, 'utf8'));
      return {
        input,
        path,
        parsed: migrateDocument(source, input, bootstrapVol),
      };
    }),
  );
  validateDocuments(
    documents.map(({ input, parsed }) => ({ label: input, parsed })),
  );

  for (const document of documents) {
    await writeFile(
      document.path,
      `${JSON.stringify(document.parsed, null, 2)}\n`,
      'utf8',
    );
    console.log(
      `${document.input}: ${cardArrayOf(document.parsed, document.input).length}枚を移行しました`,
    );
  }
}

const isCli =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
