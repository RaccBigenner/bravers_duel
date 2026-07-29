/**
 * フォーマット（対戦ルールの版）の読み込み・検証・保存のテスト。
 * 仕様: docs/ONLINE_SERVICE_DESIGN_2026-07-29.md 4.5
 */
import { describe, expect, it } from 'vitest';
import rawFormats from '../../data/formats.json';
import {
  ALL_FORMATS,
  DEFAULT_FORMAT,
  DEFAULT_FORMAT_ID,
  createFormatRegistry,
  formatByVersionId,
  formatVersionId,
  formatVersionsOf,
  isFormatActiveAt,
  latestFormat,
  parseFormatVersionId,
  serializeFormat,
  validateFormat,
  type FormatDefinition,
} from '../src/formats';

/** 検証を通る最小の生データ。各テストで壊したい項目だけ上書きする */
function rawFormat(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formatId: 'TEST_F',
    version: 1,
    nameKey: 'format.test.name',
    name: 'テスト',
    activeFrom: '2026-07-29',
    activeTo: null,
    setPolicy: 'ALL',
    latestN: null,
    allowedSetIds: [],
    bannedOracleIds: [],
    restrictedOracleIds: [],
    deckSize: 40,
    maxCopies: 4,
    characterSlotPolicy: 'EXACT_CAPACITY_3',
    zoneCopyPolicy: 'MAIN_DECK_LIMIT_ONLY',
    ...overrides,
  };
}

describe('data/formats.json の読み込み', () => {
  it('FREE_V1@1 が既定フォーマットとして読める', () => {
    expect(DEFAULT_FORMAT_ID).toBe('FREE_V1');
    expect(DEFAULT_FORMAT.formatId).toBe('FREE_V1');
    expect(DEFAULT_FORMAT.version).toBe(1);
    expect(formatVersionId(DEFAULT_FORMAT)).toBe('FREE_V1@1');
  });

  it('FREE_V1 は全弾・40枚・同名4枚・3枠ちょうど・40枚側だけで数える', () => {
    expect(DEFAULT_FORMAT.setPolicy).toBe('ALL');
    expect(DEFAULT_FORMAT.allowedSetIds).toEqual([]);
    expect(DEFAULT_FORMAT.deckSize).toBe(40);
    expect(DEFAULT_FORMAT.maxCopies).toBe(4);
    expect(DEFAULT_FORMAT.characterSlotPolicy).toBe('EXACT_CAPACITY_3');
    expect(DEFAULT_FORMAT.zoneCopyPolicy).toBe('MAIN_DECK_LIMIT_ONLY');
    expect(DEFAULT_FORMAT.bannedOracleIds).toEqual([]);
    expect(DEFAULT_FORMAT.restrictedOracleIds).toEqual([]);
  });

  it('版の参照子で引ける', () => {
    expect(formatByVersionId('FREE_V1@1')).toBe(DEFAULT_FORMAT);
    expect(formatByVersionId('FREE_V1@999')).toBeUndefined();
    expect(formatByVersionId('NOPE@1')).toBeUndefined();
    expect(latestFormat('FREE_V1')).toBe(DEFAULT_FORMAT);
    expect(latestFormat('NOPE')).toBeUndefined();
    expect(formatVersionsOf('FREE_V1').map((f) => f.version)).toEqual([1]);
    expect(formatVersionsOf('NOPE')).toEqual([]);
  });

  it('公開データに非公開の弾IDやカードIDを書いていない', () => {
    for (const format of ALL_FORMATS) {
      expect(format.allowedSetIds.every((v) => v >= 1)).toBe(true);
      expect(format.bannedOracleIds).toEqual([]);
    }
  });
});

describe('版の参照子', () => {
  it('組み立てと読み取りが往復する', () => {
    expect(formatVersionId({ formatId: 'FREE_V1', version: 3 })).toBe('FREE_V1@3');
    expect(parseFormatVersionId('FREE_V1@3')).toEqual({ formatId: 'FREE_V1', version: 3 });
    expect(parseFormatVersionId('LATEST_N_V1@12')).toEqual({
      formatId: 'LATEST_N_V1',
      version: 12,
    });
  });

  it('形が違うものは読み取れない', () => {
    for (const bad of ['FREE_V1', 'FREE_V1@', '@1', 'free_v1@1', 'FREE_V1@x', 'FREE_V1@1@2', '']) {
      expect(parseFormatVersionId(bad), bad).toBeNull();
    }
  });
});

describe('validateFormat', () => {
  it('正しい定義はそのまま読める', () => {
    const format = validateFormat(rawFormat());
    expect(format.formatId).toBe('TEST_F');
    expect(format.version).toBe(1);
    expect(format.activeTo).toBeNull();
  });

  it('EXPLICIT は使える弾を1つ以上必要とする', () => {
    const ok = validateFormat(rawFormat({ setPolicy: 'EXPLICIT', allowedSetIds: [1, 2] }));
    expect(ok.allowedSetIds).toEqual([1, 2]);
    expect(() => validateFormat(rawFormat({ setPolicy: 'EXPLICIT', allowedSetIds: [] }))).toThrow(
      /allowedSetIds が1つ以上必要/,
    );
    expect(() => validateFormat(rawFormat({ setPolicy: 'ALL', allowedSetIds: [1] }))).toThrow(
      /EXPLICIT 以外では空/,
    );
    expect(() =>
      validateFormat(rawFormat({ setPolicy: 'EXPLICIT', allowedSetIds: [1, 1] })),
    ).toThrow(/重複/);
    expect(() =>
      validateFormat(rawFormat({ setPolicy: 'EXPLICIT', allowedSetIds: [0] })),
    ).toThrow(/正の整数でない/);
  });

  it('意味が未定義の設定は黙って無視せず落とす', () => {
    // 最新N弾の数え方はまだルール文書にない（OLG-800 / P8）
    expect(() => validateFormat(rawFormat({ setPolicy: 'LATEST_N', latestN: 2 }))).toThrow(
      /まだ扱えません/,
    );
    // 制限カードの上限枚数もまだルール文書にない
    expect(() => validateFormat(rawFormat({ restrictedOracleIds: ['1-A001'] }))).toThrow(
      /まだ扱えません/,
    );
    expect(() => validateFormat(rawFormat({ setPolicy: 'UNKNOWN' }))).toThrow(/未知の setPolicy/);
    expect(() => validateFormat(rawFormat({ characterSlotPolicy: 'ANY_3' }))).toThrow(
      /未知の characterSlotPolicy/,
    );
    expect(() => validateFormat(rawFormat({ zoneCopyPolicy: 'ALL_ZONES' }))).toThrow(
      /未知の zoneCopyPolicy/,
    );
    expect(() => validateFormat(rawFormat({ latestN: 3 }))).toThrow(/latestN/);
  });

  it('壊れた項目は読み込み時に落ちる', () => {
    expect(() => validateFormat(rawFormat({ formatId: 'free_v1' }))).toThrow(/formatId/);
    expect(() => validateFormat(rawFormat({ version: 0 }))).toThrow(/version/);
    expect(() => validateFormat(rawFormat({ version: 1.5 }))).toThrow(/version/);
    expect(() => validateFormat(rawFormat({ nameKey: ' ' }))).toThrow(/nameKey/);
    expect(() => validateFormat(rawFormat({ name: '' }))).toThrow(/name が空/);
    expect(() => validateFormat(rawFormat({ activeFrom: '2026/07/29' }))).toThrow(/activeFrom/);
    expect(() => validateFormat(rawFormat({ activeTo: '2026-07-28' }))).toThrow(/activeFrom より前/);
    expect(() => validateFormat(rawFormat({ deckSize: 0 }))).toThrow(/deckSize/);
    expect(() => validateFormat(rawFormat({ maxCopies: 0 }))).toThrow(/maxCopies/);
    expect(() => validateFormat(rawFormat({ deckSize: 3, maxCopies: 4 }))).toThrow(
      /maxCopies が deckSize より大きい/,
    );
    expect(() => validateFormat(rawFormat({ bannedOracleIds: '1-A001' }))).toThrow(/配列ではない/);
    expect(() => validateFormat(rawFormat({ bannedOracleIds: [' 1-A001'] }))).toThrow(/空白/);
    expect(() => validateFormat(rawFormat({ bannedOracleIds: ['1-A001', '1-A001'] }))).toThrow(
      /重複/,
    );
  });

  it('境界値: activeTo が activeFrom と同じ日は通る／deckSize と maxCopies が同数は通る', () => {
    expect(validateFormat(rawFormat({ activeTo: '2026-07-29' })).activeTo).toBe('2026-07-29');
    expect(validateFormat(rawFormat({ deckSize: 4, maxCopies: 4 })).maxCopies).toBe(4);
  });
});

describe('保存（書き出し）と読み込みの往復', () => {
  it('serializeFormat → validateFormat で元へ戻る', () => {
    for (const format of ALL_FORMATS) {
      expect(validateFormat(serializeFormat(format))).toEqual(format);
    }
  });

  it('EXPLICIT・禁止カードつきの版も往復する', () => {
    const format = validateFormat(
      rawFormat({
        formatId: 'CUP_2026',
        version: 2,
        setPolicy: 'EXPLICIT',
        allowedSetIds: [1],
        bannedOracleIds: ['1-A001'],
        activeTo: '2026-12-31',
      }),
    );
    expect(validateFormat(serializeFormat(format))).toEqual(format);
  });

  it('書き出した形が data/formats.json と一致する', () => {
    const file = rawFormats as { formats: Record<string, unknown>[] };
    expect(ALL_FORMATS.map(serializeFormat)).toEqual(file.formats);
  });
});

describe('createFormatRegistry', () => {
  const base = validateFormat(rawFormat());
  const v2: FormatDefinition = { ...base, version: 2 };
  const v3: FormatDefinition = { ...base, version: 3 };
  const other: FormatDefinition = { ...base, formatId: 'OTHER_F' };

  it('最新版は version が一番大きいもの（並び順に依存しない）', () => {
    const registry = createFormatRegistry([v3, base, v2]);
    expect(registry.latestOf('TEST_F')?.version).toBe(3);
    expect(registry.versionsOf('TEST_F').map((f) => f.version)).toEqual([1, 2, 3]);
  });

  it('formatIdごとに分かれる', () => {
    const registry = createFormatRegistry([base, other]);
    expect(registry.latestOf('OTHER_F')?.formatId).toBe('OTHER_F');
    expect(registry.byVersionId('OTHER_F@1')?.formatId).toBe('OTHER_F');
    expect(registry.versionsOf('TEST_F')).toHaveLength(1);
  });

  it('同じ版が2つあると読み込めない', () => {
    expect(() => createFormatRegistry([base, { ...base }])).toThrow(/版が重複/);
  });

  it('空でも作れる（最新版なし）', () => {
    const registry = createFormatRegistry([]);
    expect(registry.latestOf('TEST_F')).toBeUndefined();
    expect(registry.formats).toEqual([]);
  });
});

describe('isFormatActiveAt', () => {
  const open = validateFormat(rawFormat({ activeFrom: '2026-08-01', activeTo: null }));
  const closed = validateFormat(rawFormat({ activeFrom: '2026-08-01', activeTo: '2026-08-31' }));

  it('開始日の境界', () => {
    expect(isFormatActiveAt(open, '2026-07-31')).toBe(false);
    expect(isFormatActiveAt(open, '2026-08-01')).toBe(true);
    expect(isFormatActiveAt(open, '2026-08-02')).toBe(true);
  });

  it('終了日の境界', () => {
    expect(isFormatActiveAt(closed, '2026-08-31')).toBe(true);
    expect(isFormatActiveAt(closed, '2026-09-01')).toBe(false);
  });

  it('activeTo が null なら終わらない', () => {
    expect(isFormatActiveAt(open, '2099-01-01')).toBe(true);
  });

  it('1日だけ有効な版', () => {
    const oneDay = validateFormat(rawFormat({ activeFrom: '2026-08-01', activeTo: '2026-08-01' }));
    expect(isFormatActiveAt(oneDay, '2026-07-31')).toBe(false);
    expect(isFormatActiveAt(oneDay, '2026-08-01')).toBe(true);
    expect(isFormatActiveAt(oneDay, '2026-08-02')).toBe(false);
  });
});
