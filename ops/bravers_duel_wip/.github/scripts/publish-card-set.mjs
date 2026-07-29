#!/usr/bin/env node
/**
 * 非公開WIPリポのGitHub Actions上で、2つのcheckout（公開 / WIP）だけを操作する、
 * カード弾公開の純粋なファイル変換CLI。
 *
 * 未公開カードの名前・ID・弾メタをログへ出さないため、外へ返すエラーは意図的に
 * 一般化している。詳細は作業ツリーとテストで確認し、CLI出力へ展開しないこと。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEMA_VERSION = 3;
const RARITIES = new Set(['C', 'UC', 'R', 'SR', 'SSR', 'USR', 'LSR']);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA1_RE = /^[0-9a-f]{40}$/;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_SIDE = 4096;
const MAX_EFFECT_MODULE_BYTES = 256 * 1024;
const MAX_EFFECT_TEST_BYTES = 512 * 1024;

export class PublishCardSetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PublishCardSetError';
  }
}

class InternalValidationError extends Error {}

function invalid() {
  throw new InternalValidationError();
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sameJson(left, right) {
  return stableJson(left) === stableJson(right);
}

function normalizeCardIdentity(raw) {
  if (!isRecord(raw)) invalid();
  const {
    id: legacyId,
    oracleId: rawOracleId,
    printingId: rawPrintingId,
    oracleIdProvisional: rawProvisional,
    ...rest
  } = raw;
  const printingId =
    stringValue(rawPrintingId) || stringValue(legacyId);
  const oracleId = stringValue(rawOracleId) || printingId;
  const provisional =
    rawProvisional === true || stringValue(rawOracleId) === '';
  return {
    ...rest,
    oracleId,
    printingId,
    ...(provisional ? { oracleIdProvisional: true } : {}),
  };
}

function canonicalCard(raw) {
  if (
    !isRecord(raw) ||
    (typeof raw.oracleId === 'string' &&
      raw.oracleId !== raw.oracleId.trim()) ||
    (typeof raw.printingId === 'string' &&
      raw.printingId !== raw.printingId.trim())
  ) {
    invalid();
  }
  const card = normalizeCardIdentity(raw);
  const { vol, code, rarity } = card;
  if (
    card.oracleId === '' ||
    card.printingId === '' ||
    typeof vol !== 'number' ||
    !Number.isInteger(vol) ||
    vol < 1 ||
    typeof code !== 'string' ||
    !/^A\d{3}$/.test(code.trim()) ||
    typeof rarity !== 'string' ||
    !RARITIES.has(rarity.trim())
  ) {
    invalid();
  }
  const canonicalCode = code.trim();
  const canonicalRarity = rarity.trim();
  if (card.printingId !== `${vol}-${canonicalCode}-${canonicalRarity}`) {
    invalid();
  }
  // admin/shared/cardIdentity.ts と同じく、検証材料はtrimして読むが、
  // ID以外の表示値はこの境界で勝手に書き換えない。
  return card;
}

function canonicalCards(rawCards) {
  if (!Array.isArray(rawCards)) invalid();
  const cards = rawCards.map(canonicalCard);
  const seen = new Set();
  for (const card of cards) {
    if (seen.has(card.printingId)) invalid();
    seen.add(card.printingId);
  }
  return cards;
}

function isProvisionalOracle(card) {
  return (
    card.oracleIdProvisional === true ||
    (card.oracleId !== '' && card.oracleId === card.printingId)
  );
}

function oracleGameplaySignature(card) {
  const common = { type: card.type };
  const attributes = (value) =>
    Array.isArray(value) ? [...value].sort() : value;
  switch (card.type) {
    case 'character':
      return stableJson({
        ...common,
        size: card.size,
        hp: card.hp,
        attribute: attributes(card.attribute),
      });
    case 'skill':
      return stableJson({
        ...common,
        costAp: card.costAp,
        conditionAttribute: attributes(card.conditionAttribute),
        baseValue: card.baseValue,
        valueType: card.valueType,
      });
    case 'equipment':
      return stableJson({
        ...common,
        addAttribute: attributes(card.addAttribute),
      });
    case 'field':
    default:
      return stableJson(common);
  }
}

function assertOracleRules(cards) {
  if (cards.some(isProvisionalOracle)) invalid();
  const signatures = new Map();
  for (const card of cards) {
    const signature = oracleGameplaySignature(card);
    const prior = signatures.get(card.oracleId);
    if (prior !== undefined && prior !== signature) invalid();
    signatures.set(card.oracleId, signature);
  }
}

function parseJson(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    invalid();
  }
}

function validWebpDimensions(bytes) {
  const body = Buffer.from(bytes);
  if (
    body.length < 25 ||
    body.length > MAX_IMAGE_BYTES ||
    body.toString('ascii', 0, 4) !== 'RIFF' ||
    body.toString('ascii', 8, 12) !== 'WEBP' ||
    body.readUInt32LE(4) + 8 !== body.length
  ) {
    invalid();
  }
  const chunk = body.toString('ascii', 12, 16);
  const chunkSize = body.readUInt32LE(16);
  if (20 + chunkSize + (chunkSize % 2) > body.length) invalid();

  let width;
  let height;
  if (chunk === 'VP8 ') {
    if (
      chunkSize < 10 ||
      body[23] !== 0x9d ||
      body[24] !== 0x01 ||
      body[25] !== 0x2a
    ) {
      invalid();
    }
    width = body.readUInt16LE(26) & 0x3fff;
    height = body.readUInt16LE(28) & 0x3fff;
  } else if (chunk === 'VP8L') {
    if (chunkSize < 5 || body[20] !== 0x2f) invalid();
    width = 1 + body[21] + ((body[22] & 0x3f) << 8);
    height =
      1 +
      (body[22] >> 6) +
      (body[23] << 2) +
      ((body[24] & 0x0f) << 10);
  } else if (chunk === 'VP8X') {
    if (chunkSize < 10) invalid();
    width =
      1 + body[24] + (body[25] << 8) + (body[26] << 16);
    height =
      1 + body[27] + (body[28] << 8) + (body[29] << 16);
  } else {
    invalid();
  }
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_SIDE ||
    height > MAX_IMAGE_SIDE
  ) {
    invalid();
  }
  return { width, height };
}

async function readRequired(path) {
  try {
    return await readFile(path);
  } catch {
    invalid();
  }
}

async function readOptional(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    invalid();
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    invalid();
  }
}

async function writeAtomic(path, bytes) {
  const temp = `${path}.publish-${process.pid}-${createHash('sha256')
    .update(path)
    .digest('hex')
    .slice(0, 12)}.tmp`;
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(temp, bytes);
  await rename(temp, path);
}

async function writeJson(path, value) {
  await writeAtomic(
    path,
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'),
  );
}

export function gitBlobSha(bytes) {
  const body = Buffer.from(bytes);
  return createHash('sha1')
    .update(Buffer.from(`blob ${body.length}\0`, 'utf8'))
    .update(body)
    .digest('hex');
}

function validateOptions(options, needsPublic) {
  if (
    !options ||
    !Number.isInteger(options.vol) ||
    options.vol < 1 ||
    typeof options.wipDir !== 'string' ||
    options.wipDir.trim() === '' ||
    typeof options.requestId !== 'string' ||
    !UUID_RE.test(options.requestId) ||
    (needsPublic &&
      (typeof options.publicDir !== 'string' ||
        options.publicDir.trim() === ''))
  ) {
    throw new PublishCardSetError('引数が不正です');
  }
  const wipDir = resolve(options.wipDir);
  const publicDir = needsPublic ? resolve(options.publicDir) : null;
  if (publicDir && publicDir === wipDir) {
    throw new PublishCardSetError('引数が不正です');
  }
  return {
    vol: options.vol,
    requestId: options.requestId,
    wipDir,
    publicDir,
  };
}

function pathsFor({ vol, requestId, wipDir, publicDir }) {
  return {
    active: resolve(wipDir, 'publish_jobs/active.json'),
    history: resolve(
      wipDir,
      `publish_jobs/history/${requestId}.json`,
    ),
    wipCards: resolve(wipDir, `cards/vol${vol}.json`),
    wipEffects: resolve(wipDir, `effects/vol${vol}.ts`),
    wipEffectTests: resolve(wipDir, `effects/vol${vol}.test.ts`),
    wipSets: resolve(wipDir, 'sets.wip.json'),
    wipImages: resolve(wipDir, 'images'),
    ...(publicDir
      ? {
          publicCards: resolve(publicDir, 'data/cards.json'),
          publicSets: resolve(publicDir, 'data/sets.json'),
          publicImages: resolve(publicDir, 'assets/card_images'),
          publicEffect: resolve(
            publicDir,
            `engine/src/effects/vol${vol}.ts`,
          ),
          publicEffectTest: resolve(
            publicDir,
            `engine/test/effects/vol${vol}.test.ts`,
          ),
          publicReleasedEffects: resolve(
            publicDir,
            'engine/src/effects/released.ts',
          ),
        }
      : {}),
  };
}

function setsDocument(value) {
  if (!isRecord(value) || !Array.isArray(value.sets)) invalid();
  if (value.sets.some((set) => !isRecord(set))) invalid();
  const seen = new Set();
  for (const set of value.sets) {
    if (
      typeof set.vol !== 'number' ||
      !Number.isInteger(set.vol) ||
      set.vol < 1 ||
      seen.has(set.vol)
    ) {
      invalid();
    }
    seen.add(set.vol);
  }
  return value;
}

function targetSet(sets, vol) {
  return sets.sets.find((set) => set.vol === vol) ?? null;
}

function validateManifest(raw, vol, requestId) {
  if (
    !isRecord(raw) ||
    raw.schemaVersion !== SCHEMA_VERSION ||
    raw.vol !== vol ||
    raw.requestId !== requestId ||
    !UUID_RE.test(raw.requestId) ||
    !isRecord(raw.set) ||
    raw.set.vol !== vol ||
    raw.set.status !== 'publishing' ||
    raw.set.publishOperationId !== requestId ||
    typeof raw.cardsSha !== 'string' ||
    !SHA1_RE.test(raw.cardsSha) ||
    typeof raw.effectsSha !== 'string' ||
    !SHA1_RE.test(raw.effectsSha) ||
    typeof raw.effectTestsSha !== 'string' ||
    !SHA1_RE.test(raw.effectTestsSha) ||
    !Number.isInteger(raw.cardCount) ||
    raw.cardCount < 1 ||
    !isRecord(raw.imageShas) ||
    typeof raw.createdAt !== 'string'
  ) {
    invalid();
  }
  for (const [printingId, sha] of Object.entries(raw.imageShas)) {
    if (
      typeof printingId !== 'string' ||
      typeof sha !== 'string' ||
      !SHA1_RE.test(sha)
    ) {
      invalid();
    }
  }
  return raw;
}

async function loadJob(
  options,
  { requireCurrentSet, decodeImages = false },
) {
  const paths = pathsFor(options);
  const [
    activeBytes,
    cardsBytes,
    effectsBytes,
    effectTestsBytes,
    setsBytes,
  ] = await Promise.all([
    readRequired(paths.active),
    readRequired(paths.wipCards),
    readRequired(paths.wipEffects),
    readRequired(paths.wipEffectTests),
    readRequired(paths.wipSets),
  ]);
  const active = validateManifest(
    parseJson(activeBytes),
    options.vol,
    options.requestId,
  );
  if (gitBlobSha(cardsBytes) !== active.cardsSha) invalid();
  if (
    effectsBytes.length < 1 ||
    effectsBytes.length > MAX_EFFECT_MODULE_BYTES ||
    gitBlobSha(effectsBytes) !== active.effectsSha
  ) {
    invalid();
  }
  let effectsSource;
  try {
    effectsSource = new TextDecoder('utf-8', { fatal: true }).decode(
      effectsBytes,
    );
  } catch {
    invalid();
  }
  const effectExport = new RegExp(
    `export\\s+const\\s+VOL${options.vol}_EFFECTS(?:\\s*:[^=]+)?\\s*=`,
    's',
  );
  if (!effectExport.test(effectsSource)) invalid();
  if (
    effectTestsBytes.length < 1 ||
    effectTestsBytes.length > MAX_EFFECT_TEST_BYTES ||
    gitBlobSha(effectTestsBytes) !== active.effectTestsSha
  ) {
    invalid();
  }
  let effectTestsSource;
  try {
    effectTestsSource = new TextDecoder('utf-8', { fatal: true }).decode(
      effectTestsBytes,
    );
  } catch {
    invalid();
  }
  if (!/\b(?:it|test)(?:\.each)?\s*\(/.test(effectTestsSource)) {
    invalid();
  }

  const rawCards = parseJson(cardsBytes);
  if (!Array.isArray(rawCards) || rawCards.length !== active.cardCount) {
    invalid();
  }
  const wipCards = canonicalCards(rawCards);
  if (
    wipCards.length !== active.cardCount ||
    wipCards.some((card) => card.vol !== options.vol)
  ) {
    invalid();
  }

  const cardIds = [...wipCards.map((card) => card.printingId)].sort();
  const manifestImageIds = Object.keys(active.imageShas).sort();
  if (!sameJson(cardIds, manifestImageIds)) invalid();

  const imageBytes = new Map();
  for (const printingId of cardIds) {
    const bytes = await readRequired(
      resolve(paths.wipImages, `${printingId}.webp`),
    );
    if (gitBlobSha(bytes) !== active.imageShas[printingId]) invalid();
    validWebpDimensions(bytes);
    if (decodeImages) {
      const decoder = process.env.CARD_IMAGE_DECODER;
      if (!decoder) invalid();
      const decoded = spawnSync(
        decoder,
        ['-quiet', resolve(paths.wipImages, `${printingId}.webp`), '-o', '/dev/null'],
        {
          stdio: 'ignore',
          timeout: 15_000,
        },
      );
      if (decoded.status !== 0 || decoded.error) invalid();
    }
    imageBytes.set(printingId, bytes);
  }

  const wipSets = setsDocument(parseJson(setsBytes));
  const currentSet = targetSet(wipSets, options.vol);
  if (
    requireCurrentSet &&
    (!currentSet ||
      currentSet.status !== 'publishing' ||
      !sameJson(currentSet, active.set))
  ) {
    invalid();
  }

  return {
    paths,
    active,
    cardsBytes,
    effectsBytes,
    effectTestsBytes,
    wipCards,
    wipSets,
    currentSet,
    imageBytes,
  };
}

async function loadUnlockJob(options) {
  const paths = pathsFor(options);
  const [activeBytes, setsBytes] = await Promise.all([
    readRequired(paths.active),
    readRequired(paths.wipSets),
  ]);
  const active = validateManifest(
    parseJson(activeBytes),
    options.vol,
    options.requestId,
  );
  const wipSets = setsDocument(parseJson(setsBytes));
  return {
    paths,
    active,
    wipSets,
    currentSet: targetSet(wipSets, options.vol),
  };
}

function promoteCards(cards) {
  return cards.map((card) => {
    if (card.status !== 'draft') return card;
    const { status: _drop, ...promoted } = card;
    return promoted;
  });
}

function releasedSetFrom(lockedSet) {
  const {
    publishOperationId: _dropOperation,
    status: _dropStatus,
    ...set
  } = lockedSet;
  return { ...set, status: 'released' };
}

function releasedEffectsSource(vols) {
  const canonicalVols = [...new Set(vols)].sort((left, right) => left - right);
  if (
    canonicalVols.length === 0 ||
    canonicalVols.some(
      (vol) => !Number.isInteger(vol) || vol < 1,
    )
  ) {
    invalid();
  }
  return [
    '/**',
    ' * 公開済み弾の効果module一覧。',
    ' * publisherがdata/sets.jsonから決定的に再生成するため、手で編集しない。',
    ' */',
    "import type { CardEffect } from './types';",
    ...canonicalVols.map(
      (vol) => `import { VOL${vol}_EFFECTS } from './vol${vol}';`,
    ),
    '',
    'const MODULES: readonly Readonly<Record<string, CardEffect>>[] = [',
    ...canonicalVols.map((vol) => `  VOL${vol}_EFFECTS,`),
    '];',
    'const releasedEffects: Record<string, CardEffect> = Object.create(null);',
    'for (const moduleEffects of MODULES) {',
    '  for (const [oracleId, effect] of Object.entries(moduleEffects)) {',
    '    if (Object.prototype.hasOwnProperty.call(releasedEffects, oracleId)) {',
    "      throw new Error('効果module間でOracle IDが重複しています');",
    '    }',
    '    releasedEffects[oracleId] = effect;',
    '  }',
    '}',
    'export const RELEASED_EFFECTS: Readonly<Record<string, CardEffect>> = releasedEffects;',
    '',
  ].join('\n');
}

async function loadPublic(job) {
  const [cardsBytes, setsBytes] = await Promise.all([
    readRequired(job.paths.publicCards),
    readRequired(job.paths.publicSets),
  ]);
  const cards = canonicalCards(parseJson(cardsBytes));
  const sets = setsDocument(parseJson(setsBytes));
  return { cards, sets };
}

function cardsByPrintingId(cards) {
  return new Map(cards.map((card) => [card.printingId, card]));
}

async function assertReleasedMatches(job, publicData, promoted) {
  const releasedSet = targetSet(publicData.sets, job.active.vol);
  const expectedSet = releasedSetFrom(job.active.set);
  if (
    !releasedSet ||
    releasedSet.status !== 'released' ||
    !sameJson(releasedSet, expectedSet)
  ) {
    invalid();
  }

  const publicTargetCards = publicData.cards.filter(
    (card) => card.vol === job.active.vol,
  );
  if (publicTargetCards.length !== promoted.length) invalid();
  const publicById = cardsByPrintingId(publicTargetCards);
  for (const card of promoted) {
    const published = publicById.get(card.printingId);
    if (!published || !sameJson(published, card)) invalid();
    const publicImage = await readRequired(
      resolve(job.paths.publicImages, `${card.printingId}.webp`),
    );
    const wipImage = job.imageBytes.get(card.printingId);
    if (!wipImage || !publicImage.equals(wipImage)) invalid();
  }
  const [
    publicEffect,
    publicEffectTest,
    publicReleasedEffects,
  ] = await Promise.all([
    readRequired(job.paths.publicEffect),
    readRequired(job.paths.publicEffectTest),
    readRequired(job.paths.publicReleasedEffects),
  ]);
  if (!publicEffect.equals(job.effectsBytes)) invalid();
  if (!publicEffectTest.equals(job.effectTestsBytes)) invalid();
  const expectedReleasedEffects = Buffer.from(
    releasedEffectsSource(
      publicData.sets.sets
        .filter((set) => set.status === 'released')
        .map((set) => set.vol),
    ),
    'utf8',
  );
  if (!publicReleasedEffects.equals(expectedReleasedEffects)) invalid();
  const expectedTargetImages = new Set(
    promoted.map((card) => `${card.printingId}.webp`),
  );
  const targetPrefix = `${job.active.vol}-`;
  const actualTargetImages = (await readdir(job.paths.publicImages))
    .filter(
      (name) =>
        name.startsWith(targetPrefix) &&
        /^\d+-A\d{3}-(?:C|UC|R|SR|SSR|USR|LSR)\.webp$/.test(name),
    );
  if (
    actualTargetImages.length !== expectedTargetImages.size ||
    actualTargetImages.some((name) => !expectedTargetImages.has(name))
  ) {
    invalid();
  }

  assertOracleRules(publicData.cards);
}

async function prepareImpl(options) {
  const job = await loadJob(options, {
    requireCurrentSet: true,
    decodeImages: process.env.CARD_IMAGE_DECODER_REQUIRED === '1',
  });
  const publicData = await loadPublic(job);
  const promoted = canonicalCards(promoteCards(job.wipCards));
  const released = targetSet(publicData.sets, options.vol);

  if (released?.status === 'released') {
    await assertReleasedMatches(job, publicData, promoted);
    return { ok: true, state: 'already-released' };
  }
  if (released !== null) invalid();
  if (publicData.cards.some((card) => card.vol === options.vol)) {
    invalid();
  }

  const publicById = cardsByPrintingId(publicData.cards);
  if (await pathExists(job.paths.publicEffect)) invalid();
  if (await pathExists(job.paths.publicEffectTest)) invalid();
  for (const card of promoted) {
    if (publicById.has(card.printingId)) invalid();
    if (
      await pathExists(
        resolve(job.paths.publicImages, `${card.printingId}.webp`),
      )
    ) {
      invalid();
    }
  }

  const nextCards = canonicalCards([...publicData.cards, ...promoted]);
  assertOracleRules(nextCards);
  const nextSets = {
    ...publicData.sets,
    sets: [
      ...publicData.sets.sets,
      releasedSetFrom(job.active.set),
    ].sort((left, right) => left.vol - right.vol),
  };

  for (const card of promoted) {
    await writeAtomic(
      resolve(job.paths.publicImages, `${card.printingId}.webp`),
      job.imageBytes.get(card.printingId),
    );
  }
  await writeJson(job.paths.publicCards, nextCards);
  await writeJson(job.paths.publicSets, nextSets);
  await writeAtomic(job.paths.publicEffect, job.effectsBytes);
  await writeAtomic(job.paths.publicEffectTest, job.effectTestsBytes);
  await writeAtomic(
    job.paths.publicReleasedEffects,
    Buffer.from(
      releasedEffectsSource(nextSets.sets.map((set) => set.vol)),
      'utf8',
    ),
  );
  return { ok: true, state: 'prepared' };
}

export async function prepareCardSet(rawOptions) {
  const options = validateOptions(rawOptions, true);
  try {
    return await prepareImpl(options);
  } catch {
    throw new PublishCardSetError('公開準備の検証に失敗しました');
  }
}

async function verifyImpl(options) {
  const job = await loadJob(options, { requireCurrentSet: true });
  const publicData = await loadPublic(job);
  const promoted = canonicalCards(promoteCards(job.wipCards));
  await assertReleasedMatches(job, publicData, promoted);
  return { ok: true, state: 'verified' };
}

export async function verifyCardSet(rawOptions) {
  const options = validateOptions(rawOptions, true);
  try {
    return await verifyImpl(options);
  } catch {
    throw new PublishCardSetError('公開結果の検証に失敗しました');
  }
}

async function cleanupImpl(options) {
  const job = await loadJob(options, { requireCurrentSet: true });
  const publicData = await loadPublic(job);
  const promoted = canonicalCards(promoteCards(job.wipCards));
  await assertReleasedMatches(job, publicData, promoted);

  const nextWipSets = {
    ...job.wipSets,
    sets: job.wipSets.sets.filter((set) => set.vol !== options.vol),
  };
  await unlink(job.paths.wipCards);
  await unlink(job.paths.wipEffects);
  await unlink(job.paths.wipEffectTests);
  await writeJson(job.paths.wipSets, nextWipSets);
  for (const printingId of Object.keys(job.active.imageShas)) {
    await unlink(resolve(job.paths.wipImages, `${printingId}.webp`));
  }
  await unlink(job.paths.active);
  return { ok: true, state: 'cleaned' };
}

export async function cleanupCardSet(rawOptions) {
  const options = validateOptions(rawOptions, true);
  try {
    return await cleanupImpl(options);
  } catch {
    throw new PublishCardSetError('公開後処理の検証に失敗しました');
  }
}

async function unlockImpl(options) {
  // prepareがカード形式・SHA・画像欠損で失敗した時こそ解除が必要なので、
  // unlockではカード/画像snapshotを再検証しない。操作IDとロック対象setの
  // 完全一致だけを信頼境界にし、公開済みでないことはworkflow側で確認する。
  const job = await loadUnlockJob(options);
  const unlockedSet = (() => {
    const {
      publishOperationId: _dropOperation,
      status: _dropStatus,
      ...set
    } = job.active.set;
    return { ...set, status: 'draft' };
  })();
  const isLocked =
    !!job.currentSet && sameJson(job.currentSet, job.active.set);
  const isPartiallyUnlocked =
    !!job.currentSet && sameJson(job.currentSet, unlockedSet);
  if (!isLocked && !isPartiallyUnlocked) invalid();

  const failedHistory = {
    ...job.active,
    status: 'failed_validation',
  };
  const existingHistoryBytes = await readOptional(job.paths.history);
  if (
    existingHistoryBytes &&
    !sameJson(parseJson(existingHistoryBytes), failedHistory)
  ) {
    invalid();
  }

  const nextSets = {
    ...job.wipSets,
    sets: job.wipSets.sets.map((set) =>
      set.vol === options.vol ? unlockedSet : set
    ),
  };
  if (!existingHistoryBytes) {
    await writeJson(job.paths.history, failedHistory);
  }
  if (isLocked) await writeJson(job.paths.wipSets, nextSets);
  await unlink(job.paths.active);
  return { ok: true, state: 'unlocked' };
}

export async function unlockCardSet(rawOptions) {
  const options = validateOptions(rawOptions, false);
  try {
    return await unlockImpl(options);
  } catch {
    throw new PublishCardSetError('公開ロック解除の検証に失敗しました');
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['prepare', 'verify', 'cleanup', 'unlock'].includes(command)) {
    throw new PublishCardSetError('引数が不正です');
  }
  if (rest.length % 2 !== 0) {
    throw new PublishCardSetError('引数が不正です');
  }
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (
      !['--vol', '--public-dir', '--wip-dir', '--request-id'].includes(flag) ||
      typeof value !== 'string' ||
      value === '' ||
      values.has(flag)
    ) {
      throw new PublishCardSetError('引数が不正です');
    }
    values.set(flag, value);
  }
  if (
    !values.has('--vol') ||
    !values.has('--wip-dir') ||
    !values.has('--request-id') ||
    (command !== 'unlock' && !values.has('--public-dir')) ||
    (command === 'unlock' && values.has('--public-dir'))
  ) {
    throw new PublishCardSetError('引数が不正です');
  }
  return {
    command,
    options: {
      vol: Number(values.get('--vol')),
      publicDir: values.get('--public-dir'),
      wipDir: values.get('--wip-dir'),
      requestId: values.get('--request-id'),
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const { command, options } = parseArgs(argv);
    const result =
      command === 'prepare'
        ? await prepareCardSet(options)
        : command === 'verify'
          ? await verifyCardSet(options)
        : command === 'cleanup'
          ? await cleanupCardSet(options)
          : await unlockCardSet(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const message =
      error instanceof PublishCardSetError
        ? error.message
        : '公開処理に失敗しました';
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

const entryPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (import.meta.url === entryPath) {
  process.exitCode = await main();
}
