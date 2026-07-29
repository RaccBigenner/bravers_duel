/**
 * 効果レジストリの入口。
 * oracleIdから効果定義を引く。定義が無いカードは「効果未実装」。
 * vol別の効果表も安定したoracleIdをキーにし、元printingが非公開になっても再録へ継承する。
 */
import type { CardEffect, CharacterEffect, EquipmentEffect, FieldEffect, SkillEffect } from './types';
import { RELEASED_EFFECTS } from './released';

const REGISTRY: ReadonlyMap<string, CardEffect> = new Map(
  Object.entries(RELEASED_EFFECTS),
);

export function skillEffectOf(oracleId: string): SkillEffect | null {
  const e = REGISTRY.get(oracleId);
  return e && e.kind === 'skill' ? e : null;
}

export function characterEffectOf(oracleId: string): CharacterEffect | null {
  const e = REGISTRY.get(oracleId);
  return e && e.kind === 'character' ? e : null;
}

export function equipmentEffectOf(oracleId: string): EquipmentEffect | null {
  const e = REGISTRY.get(oracleId);
  return e && e.kind === 'equipment' ? e : null;
}

export function fieldEffectOf(oracleId: string): FieldEffect | null {
  const e = REGISTRY.get(oracleId);
  return e && e.kind === 'field' ? e : null;
}

export function hasEffectImplementation(oracleId: string): boolean {
  return REGISTRY.has(oracleId);
}

/** 登録された効果のカード種別。未登録ならnull。公開ゲートの型整合検査にも使う。 */
export function effectKindOf(oracleId: string): CardEffect['kind'] | null {
  return REGISTRY.get(oracleId)?.kind ?? null;
}

/**
 * 効果が存在するだけでなく、カード種別と一致することを確認する。
 * kind違いは各 `*EffectOf` がnullを返して実戦では発動しないため、公開前に止める。
 */
export function hasCompatibleEffectImplementation(
  oracleId: string,
  cardType: CardEffect['kind'],
): boolean {
  return effectKindOf(oracleId) === cardType;
}

export function implementedEffectCount(): number {
  return REGISTRY.size;
}

/** 公開moduleに含まれるOracle ID一覧。公開ゲートのstray検査用。 */
export function implementedEffectOracleIds(): string[] {
  return [...REGISTRY.keys()].sort();
}

export * from './types';
