import { describe, expect, it } from 'vitest';
import {
  BATTLE_CARD_ID_PATTERN,
  MATCH_COMMAND_ERROR_CODES,
  MATCH_COMMAND_ID_PATTERN,
  MATCH_ID_PATTERN,
  MATCH_ACTION_TYPES,
  MAX_MATCH_REVISION,
  PROTOCOL_SCAFFOLD,
  parseBattleCardId,
  parseMatchAction,
  parseMatchCommandCandidate,
  parseMatchCommandEnvelope,
  parseMatchCommandId,
  parseMatchId,
  parseMatchRevision,
  type MatchAction,
  type MatchCommandEnvelope,
  type MatchCommandResult,
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

  it('MatchActionの11枝をruntimeでもexact decodeする', () => {
    const battleCardId = parseBattleCardId('bc_00112233445566778899aabbccddeeff');
    if (!battleCardId) throw new Error('Expected test battleCardId');
    const actions = [
      {
        type: 'playSkill',
        battleCardId,
        healTargetSlot: 0,
        targetSlot: 1,
        usingCharacterSlot: 2,
      },
      { type: 'playCharacter', battleCardId },
      { type: 'playEquipment', battleCardId, targetCharacterSlot: 0 },
      { type: 'playField', battleCardId },
      { type: 'turnStartAbility', characterSlot: 0 },
      { type: 'skipTurnStart' },
      { type: 'endPlay' },
      { type: 'playGuard', battleCardId },
      { type: 'pass' },
      { type: 'charge', battleCardId },
      { type: 'endTurn' },
    ] as const satisfies readonly MatchAction[];
    for (const action of actions) expect(parseMatchAction(action)).toEqual(action);

    for (const invalid of [
      null,
      [],
      { type: 'unknown' },
      { type: 'charge', handIndex: 0 },
      { type: 'charge', battleCardId, extra: true },
      { type: 'playEquipment', battleCardId, targetCharacterSlot: -1 },
      { type: 'playEquipment', battleCardId, targetCharacterSlot: 0.5 },
      { type: 'playSkill', battleCardId, targetSlot: undefined },
      Object.assign(Object.create({ inherited: true }), { type: 'endTurn' }),
    ]) {
      expect(parseMatchAction(invalid), JSON.stringify(invalid)).toBeNull();
    }
  });

  it('match/command IDとrevisionの境界を固定する', () => {
    expect(MATCH_ID_PATTERN.test('npc-001_test')).toBe(true);
    expect(parseMatchId('a')).toBe('a');
    expect(parseMatchId('a'.repeat(64))).toBe('a'.repeat(64));
    for (const invalid of ['', 'a'.repeat(65), 'match/1', '対戦', null]) {
      expect(parseMatchId(invalid), String(invalid)).toBeNull();
    }

    const commandId = 'cmd_00112233445566778899aabbccddeeff';
    expect(MATCH_COMMAND_ID_PATTERN.test(commandId)).toBe(true);
    expect(parseMatchCommandId(commandId)).toBe(commandId);
    for (const invalid of [
      '',
      'cmd_',
      `cmd_${'0'.repeat(31)}`,
      `cmd_${'0'.repeat(33)}`,
      `cmd_${'A'.repeat(32)}`,
      `cmd_${'g'.repeat(32)}`,
      '00112233445566778899aabbccddeeff',
      '00112233-4455-4677-8899-aabbccddeeff',
      ` ${commandId}`,
      null,
    ]) {
      expect(parseMatchCommandId(invalid), String(invalid)).toBeNull();
    }

    expect(parseMatchRevision(0)).toBe(0);
    expect(parseMatchRevision(MAX_MATCH_REVISION)).toBe(MAX_MATCH_REVISION);
    for (const invalid of [
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
      '0',
      0n,
    ]) {
      expect(parseMatchRevision(invalid), String(invalid)).toBeNull();
    }
  });

  it('OLG-122 envelopeをheader候補とexact actionの二段でdecodeする', () => {
    const matchId = parseMatchId('npc-00112233-4455-4677-8899-aabbccddeeff');
    const commandId = parseMatchCommandId('cmd_00112233445566778899aabbccddeeff');
    const expectedRevision = parseMatchRevision(0);
    const battleCardId = parseBattleCardId('bc_ffeeddccbbaa99887766554433221100');
    if (!matchId || !commandId || expectedRevision === null || !battleCardId) {
      throw new Error('Expected valid command fixtures');
    }
    const envelope = {
      matchId,
      commandId,
      expectedRevision,
      action: { type: 'charge', battleCardId },
    } as const satisfies MatchCommandEnvelope;
    expect(parseMatchCommandCandidate(envelope)).toEqual(envelope);
    expect(parseMatchCommandEnvelope(envelope)).toEqual(envelope);

    const malformedAction = {
      ...envelope,
      action: { type: 'charge', handIndex: 0 },
    };
    expect(parseMatchCommandCandidate(malformedAction)).toEqual(malformedAction);
    expect(parseMatchCommandEnvelope(malformedAction)).toBeNull();
    for (const invalid of [
      { ...envelope, unexpected: true },
      { commandId, expectedRevision, action: envelope.action },
      { ...envelope, expectedRevision: -1 },
      { ...envelope, commandId: 'cmd_invalid' },
      null,
      [],
    ]) {
      expect(parseMatchCommandCandidate(invalid), JSON.stringify(invalid)).toBeNull();
      expect(parseMatchCommandEnvelope(invalid), JSON.stringify(invalid)).toBeNull();
    }

    // @ts-expect-error top-level余剰keyはprotocol commandに存在しない
    const extra: MatchCommandEnvelope = { ...envelope, unexpected: true };
    const rawRevision: MatchCommandEnvelope = {
      ...envelope,
      // @ts-expect-error expectedRevisionはnumber一般でなく検証済みMatchRevision
      expectedRevision: 0,
    };
    expect(extra).toBeTruthy();
    expect(rawRevision).toBeTruthy();
  });

  it('command receiptはauthoritative transitionを含まないackだけに固定する', () => {
    expect(MATCH_COMMAND_ERROR_CODES).toEqual([
      'MATCH_COMMAND_ID_CONFLICT',
      'MATCH_REVISION_MISMATCH',
      'MATCH_ACTION_INVALID',
      'MATCH_ALREADY_TERMINAL',
    ]);
    const matchId = parseMatchId('match_1');
    const commandId = parseMatchCommandId('cmd_00112233445566778899aabbccddeeff');
    const baseRevision = parseMatchRevision(0);
    const revision = parseMatchRevision(1);
    if (!matchId || !commandId || baseRevision === null || revision === null) {
      throw new Error('Expected valid result fixtures');
    }
    const result = {
      type: 'matchCommandResult',
      state: 'accepted',
      matchId,
      commandId,
      baseRevision,
      revision,
    } as const satisfies MatchCommandResult;
    expect(result).toEqual({
      type: 'matchCommandResult',
      state: 'accepted',
      matchId: 'match_1',
      commandId: 'cmd_00112233445566778899aabbccddeeff',
      baseRevision: 0,
      revision: 1,
    });
    expect('transition' in result).toBe(false);
    expect('snapshot' in result).toBe(false);
  });
});
