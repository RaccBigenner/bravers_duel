/**
 * 効果レジストリの入口。
 * カードIDから効果定義を引く。定義が無いカードは「効果未実装」。
 */
import type { CardEffect, CharacterEffect, EquipmentEffect, FieldEffect, SkillEffect } from './types';
import { VOL1_EFFECTS } from './vol1';

const REGISTRY: ReadonlyMap<string, CardEffect> = new Map(Object.entries(VOL1_EFFECTS));

export function skillEffectOf(cardId: string): SkillEffect | null {
  const e = REGISTRY.get(cardId);
  return e && e.kind === 'skill' ? e : null;
}

export function characterEffectOf(cardId: string): CharacterEffect | null {
  const e = REGISTRY.get(cardId);
  return e && e.kind === 'character' ? e : null;
}

export function equipmentEffectOf(cardId: string): EquipmentEffect | null {
  const e = REGISTRY.get(cardId);
  return e && e.kind === 'equipment' ? e : null;
}

export function fieldEffectOf(cardId: string): FieldEffect | null {
  const e = REGISTRY.get(cardId);
  return e && e.kind === 'field' ? e : null;
}

export function hasEffectImplementation(cardId: string): boolean {
  return REGISTRY.has(cardId);
}

export function implementedEffectCount(): number {
  return REGISTRY.size;
}

export * from './types';
