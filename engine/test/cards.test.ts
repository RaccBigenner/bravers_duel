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

  it('キャラクターの属性は0〜4個（0個は[魔神素体]グロウのみ）', () => {
    const zeroAttr = ALL_CARDS.filter(
      (c) => c.type === 'character' && c.attribute.length === 0,
    );
    expect(zeroAttr.map((c) => c.id)).toEqual(['1-A014-SR']);
    for (const c of ALL_CARDS) {
      if (c.type === 'character') {
        expect(c.attribute.length).toBeLessThanOrEqual(4);
      }
    }
  });
});
