/**
 * カードマスターデータの読み込みと検証。
 * データ本体は data/cards.json（第1弾 144枚）。
 */
import rawCards from '../../data/cards.json';
import {
  ATTRIBUTES,
  CHARACTER_SIZES,
  RARITIES,
  SKILL_VALUE_TYPES,
  type Attribute,
  type Card,
} from './types';

function fail(id: string, message: string): never {
  throw new Error(`カードデータが不正です [${id}]: ${message}`);
}

function checkAttributes(id: string, values: unknown, field: string): Attribute[] {
  if (!Array.isArray(values)) fail(id, `${field} が配列ではない`);
  for (const v of values) {
    if (!ATTRIBUTES.includes(v as Attribute)) fail(id, `${field} に未知の属性: ${v}`);
  }
  return values as Attribute[];
}

function validateCard(raw: Record<string, unknown>): Card {
  const id = String(raw.id ?? '(idなし)');
  if (typeof raw.id !== 'string') fail(id, 'id が文字列ではない');
  if (typeof raw.vol !== 'number') fail(id, 'vol が数値ではない');
  if (typeof raw.code !== 'string') fail(id, 'code が文字列ではない');
  if (!RARITIES.includes(raw.rarity as never)) fail(id, `未知のレアリティ: ${raw.rarity}`);
  if (typeof raw.name !== 'string' || raw.name === '') fail(id, 'name が空');
  if (typeof raw.effectText !== 'string') fail(id, 'effectText が文字列ではない');
  if (typeof raw.flavorText !== 'string') fail(id, 'flavorText が文字列ではない');

  switch (raw.type) {
    case 'character': {
      if (!CHARACTER_SIZES.includes(raw.size as never)) fail(id, `未知の size: ${raw.size}`);
      if (typeof raw.hp !== 'number' || raw.hp <= 0) fail(id, `hp が不正: ${raw.hp}`);
      checkAttributes(id, raw.attribute, 'attribute');
      return raw as unknown as Card;
    }
    case 'skill': {
      if (typeof raw.costAp !== 'number' || raw.costAp < 0) fail(id, `costAp が不正: ${raw.costAp}`);
      checkAttributes(id, raw.conditionAttribute, 'conditionAttribute');
      if (typeof raw.baseValue !== 'number') fail(id, 'baseValue が数値ではない');
      if (!SKILL_VALUE_TYPES.includes(raw.valueType as never)) fail(id, `未知の valueType: ${raw.valueType}`);
      return raw as unknown as Card;
    }
    case 'equipment': {
      checkAttributes(id, raw.addAttribute, 'addAttribute');
      return raw as unknown as Card;
    }
    case 'field':
      return raw as unknown as Card;
    default:
      fail(id, `未知のカード種類: ${raw.type}`);
  }
}

/** 検証済みの全カード */
export const ALL_CARDS: Card[] = (rawCards as Record<string, unknown>[]).map(validateCard);

const byId = new Map(ALL_CARDS.map((c) => [c.id, c]));

export function cardById(id: string): Card {
  const card = byId.get(id);
  if (!card) throw new Error(`カードが見つかりません: ${id}`);
  return card;
}
