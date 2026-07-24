/**
 * スキルの基本値（baseValue）の理論値計算。
 *
 * engine/test/cards.test.ts の「効果なしスキル」テストと同じ式。
 * 制作時にこの理論値を出しておけば、リリース時に baseValue テスト（＝CI）を
 * 割る事故を作業段階で防げる。効果持ちカードは効果ぶんを割り引くので、
 * 「理論値」はあくまで割引前の目安として表示する。
 *
 * 式: (コスト+1)×2 − 1 ＋ (条件属性数 − 1) ＋ 盾ガードなら +1
 */
import type { SkillCard } from '@bravers/engine';

export function theoreticalBaseValue(card: Pick<SkillCard, 'costAp' | 'conditionAttribute' | 'valueType'>): number {
  const attrs = card.conditionAttribute ?? [];
  const guardBonus = card.valueType === 'guard' && attrs.includes('守') ? 1 : 0;
  return (card.costAp + 1) * 2 - 1 + (attrs.length - 1) + guardBonus;
}

/** support は式の対象外（効果文が能力の全て）。baseValue=0 が正 */
export function isBaseValueGoverned(card: Pick<SkillCard, 'valueType'>): boolean {
  return card.valueType !== 'support';
}
