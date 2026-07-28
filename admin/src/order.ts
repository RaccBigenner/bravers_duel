/**
 * 弾の中のカードの並び順と、その並びからの採番。
 *
 * 並び順は「第1弾がどう並んでいるか」を実データから読み取って決めた:
 *   種類（キャラ → 装備 → フィールド → スキル）
 *     → レアリティ（高い順 LSR > USR > SSR > SR > R > UC > C）
 *       → スキルはコストの高い順 → 種別（攻撃・ガード・回復・サポート）
 *
 * 第1弾はこの並びと数枚だけずれている（手で入れ替えた形跡がある）。
 * 自動並べ替えは「土台を作る道具」で、そこから手で動かす前提。
 */
import { RARITIES, SKILL_VALUE_TYPES } from '@bravers/engine';
import type { MasterCard } from './api';

/** 種類の並び順。第1弾の A001〜 の出現順そのもの */
export const TYPE_ORDER = ['character', 'equipment', 'field', 'skill'] as const;

/** レアリティは RARITIES が低い順なので、並べ替えでは逆にする */
const RARITY_RANK = new Map<string, number>(RARITIES.map((r, i) => [r, RARITIES.length - i]));

const VALUE_TYPE_RANK = new Map<string, number>(SKILL_VALUE_TYPES.map((v, i) => [v, i]));

/** カード1枚の並び順キー。小さいほど先 */
function sortKey(card: MasterCard): number[] {
  const type = TYPE_ORDER.indexOf(card.type as (typeof TYPE_ORDER)[number]);
  const rarity = RARITY_RANK.get(card.rarity) ?? 99;
  // スキルだけコストと種別で細かく並べる。キャラや装備は弾ごとに意図があるので触らない
  const cost = card.type === 'skill' ? -(card.costAp ?? 0) : 0;
  const valueType = card.type === 'skill' ? (VALUE_TYPE_RANK.get(String(card.valueType)) ?? 99) : 0;
  return [type < 0 ? 99 : type, rarity, cost, valueType];
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * 今の並び（order があればそれ、無ければ code）で安定に並べる。
 * 画面と保存の両方で「今の並び」を一意に決めるための入口。
 */
export function inCurrentOrder(cards: MasterCard[]): MasterCard[] {
  return [...cards].sort((a, b) => {
    const ao = typeof a.order === 'number' ? a.order : Number.POSITIVE_INFINITY;
    const bo = typeof b.order === 'number' ? b.order : Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return a.code.localeCompare(b.code);
  });
}

/** 第1弾と同じ考え方で並べ替える。同点は今の並びを保つ（＝手で直した順序が消えない） */
export function autoSort(cards: MasterCard[]): MasterCard[] {
  const current = inCurrentOrder(cards);
  const indexOf = new Map(current.map((c, i) => [c.id, i]));
  return [...current].sort((a, b) => {
    const byRule = compareKeys(sortKey(a), sortKey(b));
    if (byRule !== 0) return byRule;
    return (indexOf.get(a.id) ?? 0) - (indexOf.get(b.id) ?? 0);
  });
}

/** 並びのとおりに order を振り直す（0,1,2,…）。中身は変えない */
export function withOrder(cards: MasterCard[]): MasterCard[] {
  return cards.map((c, i) => ({ ...c, order: i }));
}

export interface Renumbered {
  cards: MasterCard[];
  /** 画像の引っ越し表。ID が変わったカードだけ入る */
  renames: { from: string; to: string }[];
  changed: number;
}

/**
 * 今の並びのとおりに A001 から採番し直す。
 *
 * id は `{vol}-{code}-{rarity}` なので、code が変われば id も変わる。
 * 画像は id をファイル名にしているため、**同時に引っ越さないと絵が消える**。
 * その対応表も一緒に返す。
 */
export function renumber(cards: MasterCard[], vol: number): Renumbered {
  const ordered = inCurrentOrder(cards);
  const renames: { from: string; to: string }[] = [];
  const out = ordered.map((c, i) => {
    const code = `A${String(i + 1).padStart(3, '0')}`;
    const id = `${vol}-${code}-${c.rarity}`;
    if (id !== c.id) renames.push({ from: c.id, to: id });
    return { ...c, code, id, order: i };
  });
  return { cards: out, renames, changed: renames.length };
}

// ---------------------------------------------------------------- 集計

export interface SetStats {
  total: number;
  byType: { key: string; label: string; count: number }[];
  byRarity: { key: string; count: number }[];
  byValueType: { key: string; label: string; count: number }[];
  byCost: { cost: number; count: number }[];
  /** 属性の使われ方。キャラの属性・スキルの条件属性・装備の付与属性を合算する */
  byAttribute: { key: string; count: number; cards: number }[];
  noImage: number;
}

const TYPE_LABEL: Record<string, string> = {
  character: 'キャラ',
  skill: 'スキル',
  equipment: '装備',
  field: 'フィールド',
};
const VALUE_TYPE_LABEL: Record<string, string> = {
  attack: '攻撃',
  guard: 'ガード',
  heal: '回復',
  support: 'サポート',
};

/** カード1枚が持つ属性（種類ごとに置き場が違うので吸収する） */
export function attributesOf(card: MasterCard): string[] {
  if (card.type === 'character') return card.attribute ?? [];
  if (card.type === 'skill') return card.conditionAttribute ?? [];
  if (card.type === 'equipment') return card.addAttribute ?? [];
  return [];
}

export function computeStats(cards: MasterCard[], images: Record<string, string>): SetStats {
  const count = <T>(items: T[], key: (v: T) => string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
    return m;
  };

  const typeCounts = count(cards, (c) => c.type);
  const rarityCounts = count(cards, (c) => c.rarity);
  const skills = cards.filter((c) => c.type === 'skill');
  const valueTypeCounts = count(skills, (c) => String(c.valueType ?? ''));

  const costMap = new Map<number, number>();
  for (const c of skills) {
    const cost = c.costAp ?? 0;
    costMap.set(cost, (costMap.get(cost) ?? 0) + 1);
  }

  // 属性は「延べ数」と「使っているカード枚数」を分けて数える。
  // 闇×5 のキャラのように同じ属性を重ねて持つカードがあり、延べ数だけだと実感とずれる
  const attrTotal = new Map<string, number>();
  const attrCards = new Map<string, number>();
  for (const c of cards) {
    const attrs = attributesOf(c);
    for (const a of attrs) attrTotal.set(a, (attrTotal.get(a) ?? 0) + 1);
    for (const a of new Set(attrs)) attrCards.set(a, (attrCards.get(a) ?? 0) + 1);
  }

  return {
    total: cards.length,
    byType: TYPE_ORDER.filter((t) => typeCounts.has(t)).map((t) => ({
      key: t,
      label: TYPE_LABEL[t] ?? t,
      count: typeCounts.get(t) ?? 0,
    })),
    byRarity: [...RARITIES]
      .reverse()
      .filter((r) => rarityCounts.has(r))
      .map((r) => ({ key: r, count: rarityCounts.get(r) ?? 0 })),
    byValueType: SKILL_VALUE_TYPES.filter((v) => valueTypeCounts.has(v)).map((v) => ({
      key: v,
      label: VALUE_TYPE_LABEL[v] ?? v,
      count: valueTypeCounts.get(v) ?? 0,
    })),
    byCost: [...costMap.entries()].sort((a, b) => a[0] - b[0]).map(([cost, c]) => ({ cost, count: c })),
    byAttribute: [...attrTotal.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, c]) => ({ key, count: c, cards: attrCards.get(key) ?? 0 })),
    noImage: cards.filter((c) => !images[c.id]).length,
  };
}
