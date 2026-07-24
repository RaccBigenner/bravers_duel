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

/** パックの種別（収録量の分類）。「制作中かどうか」とは別の軸（MTGの set_type 相当） */
export const PACK_TYPES = ['Normal', 'DX'] as const;
export type PackType = (typeof PACK_TYPES)[number];

/** カード・弾のライフサイクル。released だけが公開ビルドに載る */
export const CARD_STATUSES = ['draft', 'released'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

/** 弾（セット）のメタ情報。data/sets.json の1件。 */
export interface SetMeta {
  /** 弾数（製品としての通し番号）。カードの vol と対応する */
  vol: number;
  /** テーマNo.（複数弾を束ねる物語ブロック。弾数とは別軸） */
  themeNo: number;
  themeName: string;
  themeSubtitle: string;
  packType: PackType;
  /** draft の弾のカードは公開ビルドに含まれない */
  status: CardStatus;
  /** 公開日（YYYY-MM-DD）。未定なら空文字 */
  releasedAt: string;
  /** 制作中の開発コードネーム（公開前のテーマ名漏れ防止用・任意） */
  codename?: string;
}

interface CardBase {
  id: string;
  vol: number;
  code: string;
  rarity: Rarity;
  name: string;
  effectText: string;
  flavorText: string;
  /** カード個別の公開状態。省略時は released（既存カードは無記入のまま）。
   * released の弾の中でも、このカードだけ未完成にしたいとき 'draft' にする */
  status?: CardStatus;
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
