/**
 * 公開済み弾の効果module一覧。
 * publisherがdata/sets.jsonから決定的に再生成するため、手で編集しない。
 */
import type { CardEffect } from './types';
import { VOL1_EFFECTS } from './vol1';

const MODULES: readonly Readonly<Record<string, CardEffect>>[] = [
  VOL1_EFFECTS,
];
const releasedEffects: Record<string, CardEffect> = Object.create(null);
for (const moduleEffects of MODULES) {
  for (const [oracleId, effect] of Object.entries(moduleEffects)) {
    if (Object.prototype.hasOwnProperty.call(releasedEffects, oracleId)) {
      throw new Error('効果module間でOracle IDが重複しています');
    }
    releasedEffects[oracleId] = effect;
  }
}
export const RELEASED_EFFECTS: Readonly<Record<string, CardEffect>> = releasedEffects;
