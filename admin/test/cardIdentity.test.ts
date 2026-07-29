import { describe, expect, it } from 'vitest';
import {
  canonicalCardForWrite,
  canonicalCardsForWrite,
  cardIdentityProblems,
  duplicateOracleGameplayDrifts,
  duplicatePrintingIds,
  normalizeCardIdentity,
  provisionalOraclePrintingIds,
  validatePrintingRenames,
} from '../shared/cardIdentity';

const baseSkill = {
  oracleId: 'oracle-skill-1',
  printingId: '2-A001-C',
  vol: 2,
  code: 'A001',
  rarity: 'C',
  name: 'テストスキル',
  type: 'skill',
  effectText: '',
  flavorText: '',
  costAp: 1,
  conditionAttribute: ['斬'],
  baseValue: 3,
  valueType: 'attack',
};

describe('カードID境界', () => {
  it('旧idだけのWIPを読み取り時に正規化し、旧idを落とす', () => {
    const normalized = normalizeCardIdentity({
      ...baseSkill,
      oracleId: undefined,
      printingId: undefined,
      id: '2-A001-C',
    });

    expect(normalized.printingId).toBe('2-A001-C');
    expect(normalized.oracleId).toBe('2-A001-C');
    expect(normalized.oracleIdProvisional).toBe(true);
    expect(normalized).not.toHaveProperty('id');
  });

  it('旧形式由来の仮oracleを検出し、個別保存による段階移行は許す', () => {
    const provisional = {
      ...baseSkill,
      oracleId: baseSkill.printingId,
    };

    expect(cardIdentityProblems(provisional)).toEqual([]);
    expect(provisionalOraclePrintingIds([provisional])).toEqual(['2-A001-C']);
    expect(canonicalCardForWrite(provisional).oracleId).toBe(baseSkill.printingId);
  });

  it('仮oracleフラグは採番後も残り、明示解決した時だけ消える', () => {
    const normalized = normalizeCardIdentity({
      ...baseSkill,
      oracleId: undefined,
      printingId: undefined,
      id: '2-A001-C',
    });
    const renumbered = canonicalCardForWrite({
      ...normalized,
      printingId: '2-A002-C',
      code: 'A002',
    });

    expect(provisionalOraclePrintingIds([renumbered])).toEqual(['2-A002-C']);
    expect(
      canonicalCardForWrite({
        ...renumbered,
        oracleId: 'explicit-oracle',
        oracleIdProvisional: undefined,
      }),
    ).not.toHaveProperty('oracleIdProvisional');
  });

  it('printingIdとvol-code-rarityの不一致を拒否する', () => {
    expect(() =>
      canonicalCardForWrite({ ...baseSkill, printingId: '2-A002-C' }),
    ).toThrow('一致しません');
  });

  it('oracleIdとprintingIdの前後空白をcanonical writeで拒否する', () => {
    for (const card of [
      { ...baseSkill, oracleId: ` ${baseSkill.oracleId}` },
      { ...baseSkill, oracleId: `${baseSkill.oracleId} ` },
      { ...baseSkill, printingId: ` ${baseSkill.printingId}` },
      { ...baseSkill, printingId: `${baseSkill.printingId} ` },
    ]) {
      expect(cardIdentityProblems(card)).toEqual(
        expect.arrayContaining([expect.stringContaining('前後に空白')]),
      );
      expect(() => canonicalCardForWrite(card)).toThrow('前後に空白');
    }
  });

  it('不正なvol・code・rarityを管理API境界で拒否する', () => {
    expect(() =>
      canonicalCardForWrite({
        ...baseSkill,
        vol: 2.5,
        printingId: '2.5-A001-C',
      }),
    ).toThrow('正の整数');
    expect(() =>
      canonicalCardForWrite({
        ...baseSkill,
        code: 'Z1',
        printingId: '2-Z1-C',
      }),
    ).toThrow('A001形式');
    expect(() =>
      canonicalCardForWrite({
        ...baseSkill,
        rarity: 'ZZ',
        printingId: '2-A001-ZZ',
      }),
    ).toThrow('既知値');
  });

  it('canonical writeは未知フィールドを保ち、旧idは保存しない', () => {
    const canonical = canonicalCardForWrite({
      ...baseSkill,
      id: 'legacy-value',
      futureField: 'keep-me',
    });

    expect(canonical.oracleId).toBe(baseSkill.oracleId);
    expect(canonical.printingId).toBe(baseSkill.printingId);
    expect(canonical.futureField).toBe('keep-me');
    expect(canonical).not.toHaveProperty('id');
  });

  it('printingId重複を検出して配列保存を止める', () => {
    const duplicate = { ...baseSkill, oracleId: 'another-oracle' };

    expect(duplicatePrintingIds([baseSkill, duplicate])).toEqual(['2-A001-C']);
    expect(() => canonicalCardsForWrite([baseSkill, duplicate])).toThrow('重複');
  });

  it('同一oracleの収録違いは保持し、ゲーム定義driftだけを検出する', () => {
    const reprint = {
      ...baseSkill,
      printingId: '3-A010-SR',
      vol: 3,
      code: 'A010',
      rarity: 'SR',
      name: '別イラスト版',
      effectText: '翻訳・表記整理された表示文',
      flavorText: '収録ごとに違ってよい',
    };
    const drifted = {
      ...reprint,
      printingId: '3-A011-SR',
      code: 'A011',
      baseValue: 4,
    };

    expect(canonicalCardsForWrite([baseSkill, reprint])).toHaveLength(2);
    expect(duplicateOracleGameplayDrifts([baseSkill, reprint])).toEqual([]);
    expect(duplicateOracleGameplayDrifts([baseSkill, drifted])).toEqual([
      {
        oracleId: baseSkill.oracleId,
        printingIds: ['2-A001-C', '3-A011-SR'],
      },
    ]);
  });

  it('Oracle署名は属性順と表示用効果文の違いを無視し、属性重複数は区別する', () => {
    const original = {
      ...baseSkill,
      conditionAttribute: ['斬', '炎', '斬'],
    };
    const reordered = {
      ...original,
      printingId: '3-A010-SR',
      vol: 3,
      code: 'A010',
      rarity: 'SR',
      conditionAttribute: ['炎', '斬', '斬'],
      effectText: 'Translated text',
    };
    const lostDuplicate = {
      ...reordered,
      printingId: '3-A011-SR',
      code: 'A011',
      conditionAttribute: ['炎', '斬'],
    };

    expect(duplicateOracleGameplayDrifts([original, reordered])).toEqual([]);
    expect(duplicateOracleGameplayDrifts([original, lostDuplicate])).toHaveLength(1);
  });

  it('renameなしの並び保存はorderだけを変更でき、カード削除や内容変更を拒否する', () => {
    const first = { ...baseSkill, order: 0 };
    const second = {
      ...baseSkill,
      oracleId: 'oracle-skill-2',
      printingId: '2-A002-C',
      code: 'A002',
      order: 1,
    };

    expect(
      validatePrintingRenames(
        [first, second],
        [{ ...second, order: 0 }, { ...first, order: 1 }],
        [],
        2,
      ),
    ).toEqual([]);
    expect(() =>
      validatePrintingRenames([first, second], [], [], 2),
    ).toThrow('追加・削除');
    expect(() =>
      validatePrintingRenames(
        [first, second],
        [first, { ...second, baseValue: 99 }],
        [],
        2,
      ),
    ).toThrow('order以外');
    expect(() =>
      validatePrintingRenames(
        [first, second],
        [
          { ...first, printingId: '2-A003-C', code: 'A003' },
          second,
        ],
        [],
        2,
      ),
    ).toThrow('printingId');
  });

  it('nextのorderを偽装した画像swapを拒否する', () => {
    const first = { ...baseSkill, order: 0 };
    const second = {
      ...baseSkill,
      oracleId: 'oracle-skill-2',
      printingId: '2-A002-C',
      code: 'A002',
      order: 1,
    };
    const spoofed = [
      {
        ...first,
        printingId: '2-A002-C',
        code: 'A002',
        order: 0,
      },
      {
        ...second,
        printingId: '2-A001-C',
        code: 'A001',
        order: 1,
      },
    ];

    expect(() =>
      validatePrintingRenames(
        [first, second],
        spoofed,
        [
          { from: '2-A001-C', to: '2-A002-C' },
          { from: '2-A002-C', to: '2-A001-C' },
        ],
        2,
      ),
    ).toThrow('code/order');
  });

  it('事前にorder保存済みの正規swapだけを採番できる', () => {
    const first = { ...baseSkill, order: 1 };
    const second = {
      ...baseSkill,
      oracleId: 'oracle-skill-2',
      printingId: '2-A002-C',
      code: 'A002',
      order: 0,
    };
    const next = [
      {
        ...second,
        printingId: '2-A001-C',
        code: 'A001',
        order: 0,
      },
      {
        ...first,
        printingId: '2-A002-C',
        code: 'A002',
        order: 1,
      },
    ];

    expect(
      validatePrintingRenames(
        [first, second],
        next,
        [
          { from: '2-A002-C', to: '2-A001-C' },
          { from: '2-A001-C', to: '2-A002-C' },
        ],
        2,
      ),
    ).toHaveLength(2);
    expect(() =>
      validatePrintingRenames(
        [baseSkill],
        [{ ...baseSkill, printingId: '2-A002-C', code: 'A002' }],
        [{ from: '1-A001-C', to: '2-A002-C' }],
        2,
      ),
    ).toThrow('vol2');
  });

  it('同じOracleの再録同士でも、カードを変えず画像だけ交換するrenameを拒否する', () => {
    const reprint = {
      ...baseSkill,
      printingId: '2-A002-C',
      code: 'A002',
    };
    expect(() =>
      validatePrintingRenames(
        [baseSkill, reprint],
        [baseSkill, reprint],
        [
          { from: '2-A001-C', to: '2-A002-C' },
          { from: '2-A002-C', to: '2-A001-C' },
        ],
        2,
      ),
    ).toThrow('code/order');
  });
});
