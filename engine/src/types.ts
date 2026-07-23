/**
 * カードの型定義。
 * ルールの正しい情報源は docs/GAME_RULES.md（この型はそれをコードにしたもの）。
 */

export const RARITIES = ['C', 'UC', 'R', 'SR', 'SSR', 'USR', 'LSR'] as const;
export type Rarity = (typeof RARITIES)[number];

export const ATTRIBUTES = [
  // 武器系
  '斬', '突', '打', '射', '飛',
  // 元素系
  '炎', '氷', '雷', '風', '土', '木', '聖', '闇',
  // 種族・役割系
  '竜', '獣', '補', '守',
] as const;
export type Attribute = (typeof ATTRIBUTES)[number];

export const SKILL_VALUE_TYPES = ['attack', 'guard', 'support', 'heal'] as const;
export type SkillValueType = (typeof SKILL_VALUE_TYPES)[number];

export const CHARACTER_SIZES = ['normal', 'legendaryLarge'] as const;
export type CharacterSize = (typeof CHARACTER_SIZES)[number];

interface CardBase {
  id: string;
  vol: number;
  code: string;
  rarity: Rarity;
  name: string;
  effectText: string;
  flavorText: string;
}

export interface CharacterCard extends CardBase {
  type: 'character';
  size: CharacterSize;
  hp: number;
  attribute: Attribute[];
}

export interface SkillCard extends CardBase {
  type: 'skill';
  costAp: number;
  conditionAttribute: Attribute[];
  baseValue: number;
  valueType: SkillValueType;
}

export interface EquipmentCard extends CardBase {
  type: 'equipment';
  addAttribute: Attribute[];
}

export interface FieldCard extends CardBase {
  type: 'field';
}

export type Card = CharacterCard | SkillCard | EquipmentCard | FieldCard;

/** デッキ構築ルール（docs/GAME_RULES.md 4章） */
export const DECK_SIZE = 40; // 2026-07-23 社長決定（50→40に戻す。緊張感を優先）
export const MAX_CHARACTERS = 3;
export const MAX_COPIES_PER_CARD = 4; // 2026-07-22 社長決定（3→4）

/** バトルルールの定数（docs/GAME_RULES.md 5章） */
export const HAND_REFILL_TO = 5;
export const SECOND_PLAYER_STARTING_AP = 2;
export const CHARACTER_CARD_HEAL = 2;
