/**
 * フォーマット（対戦ルールの版）マスタの読み込みと検証。
 * データ本体は data/formats.json。
 *
 * 仕様: docs/ONLINE_SERVICE_DESIGN_2026-07-29.md 4.5「フォーマット」
 * ルール本体（40枚・同名4枚・キャラ3枠ちょうど）は docs/GAME_RULES.md 4章が正本。
 *
 * `formatId` + `version` の組で1つの版を表す。公開済みの版は書き換えず、新しい version を
 * 足していく。進行中の試合とリプレイは開始時の版を参照し続けるため（設計 10.5 / 11.4）。
 *
 * まだルール文書に定義がないものは「実装しない」のではなく「読み込み時に落とす」。
 * 黙って無視すると、非合法なデッキを合法と判定してしまうため。
 * - `setPolicy: 'LATEST_N'`（最新N弾）: 数え方が未定義。OLG-800 / P8 で決める
 * - `restrictedOracleIds`（制限カード）: 何枚までかが未定義。OLG-800 / P8 で決める
 */
import rawFormats from '../../data/formats.json';
import type { OracleId } from './types';

/** 使える弾の決め方（設計 4.5） */
export const SET_POLICIES = ['ALL', 'LATEST_N', 'EXPLICIT'] as const;
export type SetPolicy = (typeof SET_POLICIES)[number];

/** 意味がルール文書で確定していて、今の版で判定できる set policy */
export const SUPPORTED_SET_POLICIES: readonly SetPolicy[] = ['ALL', 'EXPLICIT'];

/** キャラクター枠の決め方。EXACT_CAPACITY_3 = 3枠ちょうど（大型は2枠、同名1枚まで） */
export const CHARACTER_SLOT_POLICIES = ['EXACT_CAPACITY_3'] as const;
export type CharacterSlotPolicy = (typeof CHARACTER_SLOT_POLICIES)[number];

/** 場と40枚側のコピー数の数え方。MAIN_DECK_LIMIT_ONLY = 上限は40枚側だけで数える */
export const ZONE_COPY_POLICIES = ['MAIN_DECK_LIMIT_ONLY'] as const;
export type ZoneCopyPolicy = (typeof ZONE_COPY_POLICIES)[number];

export interface FormatDefinition {
  /** 例: `FREE_V1` */
  formatId: string;
  /** 同じ formatId の中での版番号。1から増える */
  version: number;
  /** 表示名の翻訳キー（設計 14.2）。例: `format.free.name` */
  nameKey: string;
  /** 現在の ja-JP 表示名。翻訳基盤ができたら nameKey 側へ移す */
  name: string;
  /** この版を使い始める日（YYYY-MM-DD） */
  activeFrom: string;
  /** この版を使い終える日（YYYY-MM-DD）。null は終わりが未定 */
  activeTo: string | null;
  setPolicy: SetPolicy;
  /** LATEST_N のときの N。それ以外は null */
  latestN: number | null;
  /** EXPLICIT のときに使える弾（vol）。それ以外は空 */
  allowedSetIds: number[];
  /** 使えないカード（oracleId基準） */
  bannedOracleIds: OracleId[];
  /** 制限カード（枚数の意味が未定義のため、今は空しか受け付けない） */
  restrictedOracleIds: OracleId[];
  /** 40枚側の枚数 */
  deckSize: number;
  /** 40枚側の同名（oracle）上限 */
  maxCopies: number;
  characterSlotPolicy: CharacterSlotPolicy;
  zoneCopyPolicy: ZoneCopyPolicy;
}

/** `FREE_V1@1` の形。試合・リプレイ・デッキJSONへ書く版の参照子 */
export function formatVersionId(format: { formatId: string; version: number }): string {
  return `${format.formatId}@${format.version}`;
}

export function parseFormatVersionId(id: string): { formatId: string; version: number } | null {
  const match = /^([A-Z0-9_]+)@(\d+)$/.exec(id);
  if (!match) return null;
  return { formatId: match[1], version: Number(match[2]) };
}

function failFormat(id: string, message: string): never {
  throw new Error(`フォーマットデータが不正です [${id}]: ${message}`);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function checkOracleIds(id: string, values: unknown, field: string): OracleId[] {
  if (!Array.isArray(values)) failFormat(id, `${field} が配列ではない`);
  const seen = new Set<string>();
  for (const v of values) {
    if (typeof v !== 'string' || v.trim() === '' || v !== v.trim()) {
      failFormat(id, `${field} に空白や文字列でない値が入っている`);
    }
    if (seen.has(v)) failFormat(id, `${field} に重複がある: ${v}`);
    seen.add(v);
  }
  return values as OracleId[];
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

/** 1件のフォーマット定義を検証して読み込む（テストから架空のフォーマットも作れる） */
export function validateFormat(raw: Record<string, unknown>): FormatDefinition {
  const id = `${String(raw.formatId ?? '(formatIdなし)')}@${String(raw.version ?? '?')}`;

  const formatId = raw.formatId;
  if (typeof formatId !== 'string' || !/^[A-Z0-9_]+$/.test(formatId)) {
    failFormat(id, 'formatId は大文字英数字とアンダースコアだけ');
  }
  const version = raw.version;
  if (!isPositiveInt(version)) failFormat(id, 'version が正の整数ではない');
  const nameKey = raw.nameKey;
  if (typeof nameKey !== 'string' || nameKey.trim() === '') failFormat(id, 'nameKey が空');
  const name = raw.name;
  if (typeof name !== 'string' || name.trim() === '') failFormat(id, 'name が空');
  const activeFrom = raw.activeFrom;
  if (typeof activeFrom !== 'string' || !DATE_RE.test(activeFrom)) {
    failFormat(id, 'activeFrom がYYYY-MM-DD形式ではない');
  }
  const activeTo = raw.activeTo;
  if (activeTo !== null && (typeof activeTo !== 'string' || !DATE_RE.test(activeTo))) {
    failFormat(id, 'activeTo はnullかYYYY-MM-DD形式');
  }
  if (typeof activeTo === 'string' && activeTo < activeFrom) {
    failFormat(id, 'activeTo が activeFrom より前');
  }

  if (!SET_POLICIES.includes(raw.setPolicy as never)) {
    failFormat(id, `未知の setPolicy: ${String(raw.setPolicy)}`);
  }
  const setPolicy = raw.setPolicy as SetPolicy;
  if (!SUPPORTED_SET_POLICIES.includes(setPolicy)) {
    // 「最新N弾」の数え方がルール文書にないため、判定できないフォーマットは読み込まない。
    failFormat(id, `setPolicy ${setPolicy} はまだ扱えません（数え方が未定義。要確認）`);
  }
  // 扱える setPolicy は ALL / EXPLICIT だけなので、latestN は常に null。
  if (raw.latestN !== null) failFormat(id, 'latestN は LATEST_N 以外では null');

  const rawAllowedSetIds = raw.allowedSetIds;
  if (!Array.isArray(rawAllowedSetIds)) failFormat(id, 'allowedSetIds が配列ではない');
  for (const v of rawAllowedSetIds) {
    if (!isPositiveInt(v)) failFormat(id, `allowedSetIds に正の整数でない値: ${String(v)}`);
  }
  const allowedSetIds = [...new Set(rawAllowedSetIds as number[])];
  if (allowedSetIds.length !== rawAllowedSetIds.length) {
    failFormat(id, 'allowedSetIds に重複がある');
  }
  if (setPolicy === 'EXPLICIT' && allowedSetIds.length === 0) {
    failFormat(id, 'EXPLICIT には allowedSetIds が1つ以上必要');
  }
  if (setPolicy !== 'EXPLICIT' && allowedSetIds.length > 0) {
    failFormat(id, 'allowedSetIds は EXPLICIT 以外では空');
  }

  const bannedOracleIds = checkOracleIds(id, raw.bannedOracleIds, 'bannedOracleIds');
  const restrictedOracleIds = checkOracleIds(id, raw.restrictedOracleIds, 'restrictedOracleIds');
  if (restrictedOracleIds.length > 0) {
    // 「制限」で何枚まで入れられるかがルール文書にないため、黙って無視せず落とす。
    failFormat(id, 'restrictedOracleIds はまだ扱えません（上限枚数が未定義。要確認）');
  }

  const deckSize = raw.deckSize;
  if (!isPositiveInt(deckSize)) failFormat(id, 'deckSize が正の整数ではない');
  const maxCopies = raw.maxCopies;
  if (!isPositiveInt(maxCopies)) failFormat(id, 'maxCopies が正の整数ではない');
  if (maxCopies > deckSize) failFormat(id, 'maxCopies が deckSize より大きい');
  if (!CHARACTER_SLOT_POLICIES.includes(raw.characterSlotPolicy as never)) {
    failFormat(id, `未知の characterSlotPolicy: ${String(raw.characterSlotPolicy)}`);
  }
  if (!ZONE_COPY_POLICIES.includes(raw.zoneCopyPolicy as never)) {
    failFormat(id, `未知の zoneCopyPolicy: ${String(raw.zoneCopyPolicy)}`);
  }

  return {
    formatId,
    version,
    nameKey,
    name,
    activeFrom,
    activeTo,
    setPolicy,
    latestN: null,
    allowedSetIds,
    bannedOracleIds,
    restrictedOracleIds,
    deckSize,
    maxCopies,
    characterSlotPolicy: raw.characterSlotPolicy as CharacterSlotPolicy,
    zoneCopyPolicy: raw.zoneCopyPolicy as ZoneCopyPolicy,
  };
}

/**
 * フォーマット版を data/formats.json と同じ形へ書き戻す（保存用）。
 * `validateFormat(serializeFormat(f))` が元へ戻ることをテストで固定している。
 * 公開済みの版を上書き保存するためではなく、新しい版を足すときの書き出し口。
 */
export function serializeFormat(format: FormatDefinition): Record<string, unknown> {
  return {
    formatId: format.formatId,
    version: format.version,
    nameKey: format.nameKey,
    name: format.name,
    activeFrom: format.activeFrom,
    activeTo: format.activeTo,
    setPolicy: format.setPolicy,
    latestN: format.latestN,
    allowedSetIds: [...format.allowedSetIds],
    bannedOracleIds: [...format.bannedOracleIds],
    restrictedOracleIds: [...format.restrictedOracleIds],
    deckSize: format.deckSize,
    maxCopies: format.maxCopies,
    characterSlotPolicy: format.characterSlotPolicy,
    zoneCopyPolicy: format.zoneCopyPolicy,
  };
}

/** 同じ (formatId, version) が2つ以上ないか調べて、検索できる形にまとめる */
export function createFormatRegistry(formats: readonly FormatDefinition[]) {
  const byVersionId = new Map<string, FormatDefinition>();
  const byFormatId = new Map<string, FormatDefinition[]>();
  for (const format of formats) {
    const versionId = formatVersionId(format);
    if (byVersionId.has(versionId)) {
      throw new Error(`フォーマットの版が重複しています: ${versionId}`);
    }
    byVersionId.set(versionId, format);
    const versions = byFormatId.get(format.formatId) ?? [];
    versions.push(format);
    byFormatId.set(format.formatId, versions);
  }
  for (const versions of byFormatId.values()) versions.sort((a, b) => a.version - b.version);

  return {
    formats: [...formats],
    byVersionId: (versionId: string) => byVersionId.get(versionId),
    versionsOf: (formatId: string): readonly FormatDefinition[] => byFormatId.get(formatId) ?? [],
    latestOf: (formatId: string): FormatDefinition | undefined => {
      const versions = byFormatId.get(formatId);
      return versions && versions.length > 0 ? versions[versions.length - 1] : undefined;
    },
  };
}

export type FormatRegistry = ReturnType<typeof createFormatRegistry>;

/** data/formats.json に書かれた全フォーマット版 */
export const ALL_FORMATS: FormatDefinition[] = (
  ((rawFormats as { formats?: unknown }).formats as Record<string, unknown>[]) ?? []
).map(validateFormat);

export const FORMAT_REGISTRY: FormatRegistry = createFormatRegistry(ALL_FORMATS);

/** 版の参照子（`FREE_V1@1`）から探す */
export function formatByVersionId(versionId: string): FormatDefinition | undefined {
  return FORMAT_REGISTRY.byVersionId(versionId);
}

/** その formatId の全版（version昇順） */
export function formatVersionsOf(formatId: string): readonly FormatDefinition[] {
  return FORMAT_REGISTRY.versionsOf(formatId);
}

/** その formatId の最新版 */
export function latestFormat(formatId: string): FormatDefinition | undefined {
  return FORMAT_REGISTRY.latestOf(formatId);
}

export const DEFAULT_FORMAT_ID = 'FREE_V1';

/** 何も選ばなかったときのフォーマット（公開済みの全弾が使えるフリールール） */
export const DEFAULT_FORMAT: FormatDefinition = (() => {
  const format = latestFormat(DEFAULT_FORMAT_ID);
  if (!format) throw new Error(`既定フォーマットが見つかりません: ${DEFAULT_FORMAT_ID}`);
  return format;
})();

/**
 * その日にこの版を使えるか。
 * エンジンは現在時刻を自分で読まない（設計 11.4）ので、日付は呼び出し側から渡す。
 */
export function isFormatActiveAt(format: FormatDefinition, date: string): boolean {
  if (date < format.activeFrom) return false;
  if (format.activeTo !== null && date > format.activeTo) return false;
  return true;
}
