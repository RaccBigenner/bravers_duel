/**
 * カードマスターデータの読み込みと検証。
 * データ本体は data/cards.json（公開済みの弾のカード）。
 *
 * 重要: この data/cards.json は Vite ビルドで公開JSにそのまま埋め込まれる。
 * つまり「ここに入れたカード＝世界中の誰でも読める」。制作中の弾は絶対にここへ入れず、
 * data/wip/（gitignore）に置くこと。念のため下の ALL_CARDS でも
 * 「released の弾に属するカードだけ」に絞る二重の安全策をかけている。
 */
import rawCards from '../../data/cards.json';
import { isVolReleased } from './sets';
import {
  ATTRIBUTES,
  CARD_STATUSES,
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
  if (raw.status !== undefined && !CARD_STATUSES.includes(raw.status as never)) {
    fail(id, `未知の status: ${raw.status}`);
  }

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

/** data/cards.json に入っている検証済みカード（原則すべて公開弾のもの） */
const VALIDATED_CARDS: Card[] = (rawCards as Record<string, unknown>[]).map(validateCard);

/** そのカードが公開ビルドに載るか（released の弾に属し、カード個別も draft でない） */
function isPublicCard(c: Card): boolean {
  if (c.status === 'draft') return false;
  return isVolReleased(c.vol);
}

/**
 * 公開されている全カード。ゲーム本体・カード一覧・デッキ構築はこれだけを見る。
 * 万一 data/cards.json に未公開弾のカードが紛れても、ここで弾い（除外し）て漏れを防ぐ。
 */
export const ALL_CARDS: Card[] = VALIDATED_CARDS.filter(isPublicCard);

const byId = new Map(ALL_CARDS.map((c) => [c.id, c]));

export function cardById(id: string): Card {
  const card = byId.get(id);
  if (!card) throw new Error(`カードが見つかりません: ${id}`);
  return card;
}
