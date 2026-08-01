import { describe, expect, it } from 'vitest';
import {
  BATTLE_CARD_ID_PATTERN,
  MATCH_ACTION_TYPES,
  PROTOCOL_SCAFFOLD,
  parseBattleCardId,
  type MatchAction,
} from '../src/index';

describe('@bravers/protocol scaffold', () => {
  it('実型を先行確定せずworkspaceの入口だけを公開する', () => {
    expect(PROTOCOL_SCAFFOLD).toEqual({
      version: 'OLG-101',
      operational: false,
    });
  });

  it('OLG-123のaction種別を固定し、card actionはbattleCardIdを要求する', () => {
    expect(MATCH_ACTION_TYPES).toEqual([
      'playSkill',
      'playCharacter',
      'playEquipment',
      'playField',
      'turnStartAbility',
      'skipTurnStart',
      'endPlay',
      'playGuard',
      'pass',
      'charge',
      'endTurn',
    ]);

    const battleCardId = parseBattleCardId('bc_00112233445566778899aabbccddeeff');
    if (!battleCardId) throw new Error('Expected test battleCardId');
    const cardActions = [
      { type: 'playSkill', battleCardId },
      { type: 'playCharacter', battleCardId },
      { type: 'playEquipment', battleCardId, targetCharacterSlot: 1 },
      { type: 'playField', battleCardId },
      { type: 'playGuard', battleCardId },
      { type: 'charge', battleCardId },
    ] as const satisfies readonly MatchAction[];
    const action = cardActions[2];
    expect(action.battleCardId).toMatch(/^bc_[0-9a-f]{32}$/);
    expect('handIndex' in action).toBe(false);

    // @ts-expect-error clientのhandIndexはprotocol actionに存在しない
    const legacy: MatchAction = { type: 'charge', handIndex: 0 };
    // @ts-expect-error cardを使わない枝へbattleCardIdを付けない
    const extraCard: MatchAction = { type: 'endTurn', battleCardId };
    expect(legacy).toBeTruthy();
    expect(extraCard).toBeTruthy();
  });

  it('battleCardIdはlowercase 128-bit形式だけを受理する', () => {
    const valid = 'bc_00112233445566778899aabbccddeeff';
    expect(BATTLE_CARD_ID_PATTERN.test(valid)).toBe(true);
    expect(parseBattleCardId(valid)).toBe(valid);
    for (const invalid of [
      '',
      'bc_',
      `bc_${'0'.repeat(31)}`,
      `bc_${'0'.repeat(33)}`,
      `bc_${'A'.repeat(32)}`,
      `bc_${'g'.repeat(32)}`,
      '00112233445566778899aabbccddeeff',
      '01890f24-7f5f-7cc4-98ab-001122334455',
      null,
      1,
    ]) {
      expect(parseBattleCardId(invalid), String(invalid)).toBeNull();
    }
  });
});
