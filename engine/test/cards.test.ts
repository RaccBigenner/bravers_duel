import { describe, expect, it } from 'vitest';
import { ALL_CARDS, cardById } from '../src/cards';

describe('カードマスターデータ', () => {
  it('第1弾は144枚ある', () => {
    expect(ALL_CARDS).toHaveLength(144);
  });

  it('id が重複していない', () => {
    const ids = ALL_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('種類ごとの枚数が正しい', () => {
    const count = (t: string) => ALL_CARDS.filter((c) => c.type === t).length;
    expect(count('character')).toBe(24);
    expect(count('skill')).toBe(108);
    expect(count('equipment')).toBe(8);
    expect(count('field')).toBe(4);
  });

  it('id でカードを引ける', () => {
    expect(cardById('1-A001-LSR').name).toBe('[集合知]アイ');
    expect(() => cardById('存在しないID')).toThrow();
  });

  it('効果なしスキルの基本値は (1+コスト)×2−1＋(条件属性数−1)、guardはさらに+1（バランス調整v2）', () => {
    for (const c of ALL_CARDS) {
      if (c.type === 'skill' && c.effectText === '') {
        const guardBonus = c.valueType === 'guard' ? 1 : 0;
        const expected = (c.costAp + 1) * 2 - 1 + (c.conditionAttribute.length - 1) + guardBonus;
        expect(c.baseValue, `${c.id} ${c.name}`).toBe(expected);
      }
    }
  });

  it('supportスキルの基本値は0（効果文が能力の全て）', () => {
    for (const c of ALL_CARDS) {
      if (c.type === 'skill' && c.valueType === 'support') {
        expect(c.baseValue, `${c.id} ${c.name}`).toBe(0);
      }
    }
  });

  it('キャラクターの属性は0〜5個（0個はグロウ、5個はトランザードのみ）', () => {
    const zeroAttr = ALL_CARDS.filter(
      (c) => c.type === 'character' && c.attribute.length === 0,
    );
    expect(zeroAttr.map((c) => c.id)).toEqual(['1-A014-SR']);
    const fiveAttr = ALL_CARDS.filter(
      (c) => c.type === 'character' && c.attribute.length >= 5,
    );
    expect(fiveAttr.map((c) => c.id)).toEqual(['1-A004-USR']);
    for (const c of ALL_CARDS) {
      if (c.type === 'character') {
        expect(c.attribute.length).toBeLessThanOrEqual(5);
      }
    }
  });
});
