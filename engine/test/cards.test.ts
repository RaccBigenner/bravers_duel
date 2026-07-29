import { describe, expect, it } from 'vitest';
import rawCards from '../../data/cards.json';
import {
  ALL_CARDS,
  cardById,
  cardByPrintingId,
  createCardCatalog,
  printingsByOracleId,
  validateCard,
} from '../src/cards';
import type { CharacterCard, SkillCard } from '../src/types';

describe('カードマスターデータ', () => {
  it('第1弾は144枚ある', () => {
    expect(ALL_CARDS.filter((card) => card.vol === 1)).toHaveLength(144);
  });

  it('oracleId/printingIdが必須で、printingIdが重複していない', () => {
    expect(ALL_CARDS.every((c) => c.oracleId !== '' && c.printingId !== '')).toBe(true);
    const printingIds = ALL_CARDS.map((c) => c.printingId);
    expect(new Set(printingIds).size).toBe(printingIds.length);
  });

  it('raw dataはoracleId+printingIdだけを保存し、旧idを持たない', () => {
    for (const raw of rawCards as Record<string, unknown>[]) {
      expect(raw.oracleId).toBeTypeOf('string');
      expect(raw.printingId).toBeTypeOf('string');
      expect(raw).not.toHaveProperty('id');
    }
  });

  it('oracleIdの前後空白を読込境界で拒否する', () => {
    const source = rawCards[0] as Record<string, unknown>;
    for (const oracleId of [
      ` ${String(source.oracleId)}`,
      `${String(source.oracleId)} `,
    ]) {
      expect(() => validateCard({ ...source, oracleId })).toThrow(
        'oracleId の前後に空白',
      );
    }
  });

  it('printingIdはvol-code-rarityと一致し、第1弾oracleIdの現在値を維持する', () => {
    const firstSet = ALL_CARDS.filter((c) => c.vol === 1);
    expect(firstSet).toHaveLength(144);
    for (const card of firstSet) {
      expect(card.printingId).toBe(`${card.vol}-${card.code}-${card.rarity}`);
      expect(card.oracleId).toBe(`${card.vol}-${card.code}`);
    }
  });

  it('種類ごとの枚数が正しい', () => {
    const count = (t: string) =>
      ALL_CARDS.filter((c) => c.vol === 1 && c.type === t).length;
    expect(count('character')).toBe(24);
    expect(count('skill')).toBe(108);
    expect(count('equipment')).toBe(8);
    expect(count('field')).toBe(4);
  });

  it('LSRキャラクターは2枠を使うlegendaryLargeである', () => {
    const lsrCharacters = ALL_CARDS.filter(
      (c): c is CharacterCard => c.type === 'character' && c.rarity === 'LSR',
    );
    expect(lsrCharacters).not.toHaveLength(0);
    for (const card of lsrCharacters) {
      expect(card.size, `${card.printingId} ${card.name}`).toBe('legendaryLarge');
    }
  });

  it('printingIdでカードを引き、oracleIdから印刷一覧を引ける', () => {
    const ai = cardByPrintingId('1-A001-LSR');
    expect(ai.name).toBe('[集合知]アイ');
    expect(printingsByOracleId(ai.oracleId).map((c) => c.printingId)).toContain('1-A001-LSR');
    expect(() => cardByPrintingId('存在しないID')).toThrow();
  });

  it('旧cardByIdはprintingId検索の互換aliasで、カードJSONには旧idを戻さない', () => {
    const ai = cardByPrintingId('1-A001-LSR');
    expect(cardById(ai.printingId)).toBe(ai);
    expect((ai as unknown as { readonly id: string }).id).toBe(ai.printingId);
    expect(Object.keys(ai)).not.toContain('id');
    expect(JSON.parse(JSON.stringify(ai))).not.toHaveProperty('id');
  });

  it('同じoracleの別printingは見た目が違ってもcatalogへ登録できる', () => {
    const original = cardByPrintingId('1-A037-USR') as SkillCard;
    const reprint: SkillCard = {
      ...original,
      printingId: '99-Z996-C',
      vol: 99,
      code: 'Z996',
      rarity: 'C',
      name: '別言語・別イラスト名',
      effectText: 'Translated display text; gameplay still comes from the Oracle registry.',
      flavorText: '再録固有のフレーバー',
    };
    const catalog = createCardCatalog([...ALL_CARDS, reprint]);

    expect(catalog.printingsByOracleId(original.oracleId)).toHaveLength(2);
  });

  it('同じoracleの属性順は不問だが、属性の重複数はゲーム定義として検査する', () => {
    const original = cardByPrintingId('1-A045-SR') as SkillCard;
    const reordered: SkillCard = {
      ...original,
      printingId: '99-Z994-C',
      vol: 99,
      code: 'Z994',
      rarity: 'C',
      conditionAttribute: [...original.conditionAttribute].reverse(),
    };
    expect(() => createCardCatalog([...ALL_CARDS, reordered])).not.toThrow();

    const lostAttribute: SkillCard = {
      ...reordered,
      printingId: '99-Z993-C',
      code: 'Z993',
      conditionAttribute: [original.conditionAttribute[0]],
    };
    expect(() => createCardCatalog([...ALL_CARDS, lostAttribute])).toThrow(
      'ゲーム定義が一致しません',
    );
  });

  it('同じoracleのゲーム定義driftをcatalog生成時に拒否する', () => {
    const original = cardByPrintingId('1-A037-USR') as SkillCard;
    const drifted: SkillCard = {
      ...original,
      printingId: '99-Z995-C',
      vol: 99,
      code: 'Z995',
      rarity: 'C',
      baseValue: original.baseValue + 1,
    };

    expect(() => createCardCatalog([...ALL_CARDS, drifted])).toThrow('ゲーム定義が一致しません');
  });

  it('効果なしスキルの基本値は (1+コスト)×2−1＋(条件属性数−1)、盾（守属性guard）はさらに+1（バランス調整v2）', () => {
    for (const c of ALL_CARDS) {
      if (c.type === 'skill' && c.effectText === '') {
        const guardBonus = c.valueType === 'guard' && c.conditionAttribute.includes('守') ? 1 : 0;
        const expected = (c.costAp + 1) * 2 - 1 + (c.conditionAttribute.length - 1) + guardBonus;
        expect(c.baseValue, `${c.printingId} ${c.name}`).toBe(expected);
      }
    }
  });

  it('supportスキルの基本値は0（効果文が能力の全て）', () => {
    for (const c of ALL_CARDS) {
      if (c.type === 'skill' && c.valueType === 'support') {
        expect(c.baseValue, `${c.printingId} ${c.name}`).toBe(0);
      }
    }
  });

  it('キャラクターの属性は0〜5個（0個はグロウ、5個はトランザードのみ）', () => {
    const zeroAttr = ALL_CARDS.filter(
      (c) => c.type === 'character' && c.attribute.length === 0,
    );
    expect(zeroAttr.map((c) => c.printingId)).toEqual(['1-A014-SR']);
    const fiveAttr = ALL_CARDS.filter(
      (c) => c.type === 'character' && c.attribute.length >= 5,
    );
    expect(fiveAttr.map((c) => c.printingId)).toEqual(['1-A004-USR']);
    for (const c of ALL_CARDS) {
      if (c.type === 'character') {
        expect(c.attribute.length).toBeLessThanOrEqual(5);
      }
    }
  });
});
