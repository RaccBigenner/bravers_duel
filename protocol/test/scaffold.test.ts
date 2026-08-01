import { describe, expect, it } from 'vitest';
import {
  BATTLE_CARD_ID_PATTERN,
  MATCH_COMMAND_ERROR_CODES,
  MATCH_COMMAND_ID_PATTERN,
  MATCH_ID_PATTERN,
  MATCH_ACTION_TYPES,
  MATCH_PLAYER_PROJECTION_VERSION,
  MAX_MATCH_REVISION,
  PROTOCOL_SCAFFOLD,
  parseBattleCardId,
  parseMatchAction,
  parseMatchCommandCandidate,
  parseMatchCommandEnvelope,
  parseMatchCommandClientFrame,
  parseMatchCommandId,
  parseMatchCommandResult,
  parseMatchId,
  parseMatchPlayerProjection,
  parseMatchRevision,
  parseMatchServerFrame,
  type MatchAction,
  type MatchCommandEnvelope,
  type MatchCommandResult,
  type MatchPlayerProjection,
} from '../src/index';

describe('@bravers/protocol scaffold', () => {
  it('OLG-124 browser command/projection wireをoperationalとして公開する', () => {
    expect(PROTOCOL_SCAFFOLD).toEqual({
      version: 'OLG-124',
      operational: true,
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

  it('command receiptはerrorごとのexact fieldとackだけに固定する', () => {
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
    const accepted = {
      type: 'matchCommandResult',
      state: 'accepted',
      matchId,
      commandId,
      baseRevision,
      revision,
    } as const satisfies MatchCommandResult;
    const mismatch = {
      type: 'matchCommandResult',
      state: 'rejected',
      matchId,
      commandId,
      errorCode: 'MATCH_REVISION_MISMATCH',
      revision,
      relation: 'stale',
    } as const satisfies MatchCommandResult;
    const invalidAction = {
      type: 'matchCommandResult',
      state: 'rejected',
      matchId,
      commandId,
      errorCode: 'MATCH_ACTION_INVALID',
      revision,
    } as const satisfies MatchCommandResult;
    const terminal = {
      type: 'matchCommandResult',
      state: 'rejected',
      matchId,
      commandId,
      errorCode: 'MATCH_ALREADY_TERMINAL',
      revision,
    } as const satisfies MatchCommandResult;
    const conflict = {
      type: 'matchCommandResult',
      state: 'rejected',
      matchId,
      commandId,
      errorCode: 'MATCH_COMMAND_ID_CONFLICT',
      originalRevision: revision,
    } as const satisfies MatchCommandResult;

    expect(accepted).toEqual({
      type: 'matchCommandResult',
      state: 'accepted',
      matchId: 'match_1',
      commandId: 'cmd_00112233445566778899aabbccddeeff',
      baseRevision: 0,
      revision: 1,
    });
    expect(mismatch).toMatchObject({ relation: 'stale', revision: 1 });
    expect(invalidAction).not.toHaveProperty('relation');
    expect(terminal).not.toHaveProperty('relation');
    expect(conflict).toMatchObject({ originalRevision: 1 });
    expect(conflict).not.toHaveProperty('revision');
    expect('transition' in accepted).toBe(false);
    expect('snapshot' in accepted).toBe(false);

    for (const receipt of [accepted, mismatch, invalidAction, terminal, conflict]) {
      expect(parseMatchCommandResult(receipt)).toEqual(receipt);
    }
    for (const invalid of [
      { ...accepted, revision: 2 },
      { ...accepted, transition: {} },
      { ...mismatch, relation: 'current' },
      { ...mismatch, relation: undefined },
      { ...invalidAction, relation: 'ahead' },
      { ...terminal, errorCode: 'MATCH_UNKNOWN' },
      { ...conflict, revision: 1 },
      { ...conflict, originalRevision: -1 },
      null,
      [],
    ]) {
      expect(parseMatchCommandResult(invalid), JSON.stringify(invalid)).toBeNull();
    }

    // @ts-expect-error revision mismatchにはstale/aheadが必須
    const missingRelation: MatchCommandResult = {
      type: 'matchCommandResult',
      state: 'rejected',
      matchId,
      commandId,
      errorCode: 'MATCH_REVISION_MISMATCH',
      revision,
    };
    const invalidActionRelation: MatchCommandResult = {
      type: 'matchCommandResult',
      state: 'rejected',
      matchId,
      commandId,
      errorCode: 'MATCH_ACTION_INVALID',
      revision,
      // @ts-expect-error action rejectへrevision relationを付けない
      relation: 'ahead',
    };
    const conflictRevision: MatchCommandResult = {
      type: 'matchCommandResult',
      state: 'rejected',
      matchId,
      commandId,
      errorCode: 'MATCH_COMMAND_ID_CONFLICT',
      // @ts-expect-error ID conflictはrevisionでなくoriginalRevisionだけを返す
      revision,
    };
    expect(missingRelation).toBeTruthy();
    expect(invalidActionRelation).toBeTruthy();
    expect(conflictRevision).toBeTruthy();
  });

  it('OLG-124 projectionとclient/server frameをnested exact decodeする', () => {
    const matchId = parseMatchId('match_projection');
    const revision = parseMatchRevision(1);
    const commandId = parseMatchCommandId('cmd_00112233445566778899aabbccddeeff');
    const ownHandId = parseBattleCardId('bc_00112233445566778899aabbccddeeff');
    const ownCharacterId = parseBattleCardId('bc_11112222333344445555666677778888');
    const enemyCharacterId = parseBattleCardId('bc_9999aaaabbbbccccddddeeeeffff0000');
    if (!matchId || revision === null || !commandId || !ownHandId || !ownCharacterId || !enemyCharacterId) {
      throw new Error('Expected valid projection fixtures');
    }
    const projection = {
      type: 'matchPlayerProjection',
      projectionVersion: MATCH_PLAYER_PROJECTION_VERSION,
      matchId,
      viewerSeat: 'player-1',
      viewerPlayer: 0,
      revision,
      eventSequence: 3,
      contentVersion: 'content-test',
      formatVersionId: 'standard@1',
      turn: 1,
      activePlayer: 0,
      phase: 'play',
      firstPlayer: 0,
      pendingAttack: null,
      field: null,
      players: [
        {
          player: 0,
          deckCount: 34,
          hand: {
            visibility: 'private',
            cards: [{ battleCardId: ownHandId, printingId: 'B-001' }],
          },
          trash: [],
          apCount: 1,
          characters: [{
            card: { battleCardId: ownCharacterId, printingId: 'C-001' },
            damage: 0,
            addedAttributes: [],
            equipment: null,
          }],
          actorSlot: 0,
          skillsUsedThisTurn: 0,
          nextSkillCostDelta: 0,
          nextDrawDelta: 0,
          actorLockUntilTurn: 0,
          incomingDamageReduction: null,
          chargedThisTurn: 0,
        },
        {
          player: 1,
          deckCount: 35,
          hand: { visibility: 'hidden', count: 4 },
          trash: [],
          apCount: 0,
          characters: [{
            card: { battleCardId: enemyCharacterId, printingId: 'C-002' },
            damage: 1,
            addedAttributes: [],
            equipment: null,
          }],
          actorSlot: 0,
          skillsUsedThisTurn: 0,
          nextSkillCostDelta: 0,
          nextDrawDelta: 0,
          actorLockUntilTurn: 0,
          incomingDamageReduction: null,
          chargedThisTurn: 0,
        },
      ],
      winner: null,
      endReason: null,
      terminal: null,
      legalActions: [{ type: 'charge', battleCardId: ownHandId }, { type: 'endPlay' }],
    } as const satisfies MatchPlayerProjection;
    expect(parseMatchPlayerProjection(projection)).toEqual(projection);
    expect(JSON.stringify(projection)).not.toContain('seed');
    expect(JSON.stringify(projection)).not.toContain('rngState');

    const commandFrame = {
      type: 'matchCommand',
      command: {
        matchId,
        commandId,
        expectedRevision: revision,
        action: { type: 'charge', battleCardId: ownHandId },
      },
    } as const;
    expect(parseMatchCommandClientFrame(commandFrame)).toEqual(commandFrame);
    expect(parseMatchCommandClientFrame({ ...commandFrame, extra: true })).toBeNull();

    const receipt = {
      type: 'matchCommandResult',
      state: 'rejected',
      matchId,
      commandId,
      errorCode: 'MATCH_ACTION_INVALID',
      revision,
    } as const satisfies MatchCommandResult;
    const update = { type: 'matchCommandUpdate', receipt, projection } as const;
    expect(parseMatchServerFrame(update)).toEqual(update);
    expect(parseMatchServerFrame({ ...update, lifecycle: 'active' })).toBeNull();
    expect(parseMatchServerFrame({
      ...update,
      projection: { ...projection, revision: 0 },
    })).toBeNull();

    expect(parseMatchPlayerProjection({ ...projection, seed: 123 })).toBeNull();
    expect(parseMatchPlayerProjection({
      ...projection,
      viewerPlayer: 1,
      players: [
        { ...projection.players[0], hand: { visibility: 'hidden', count: 1 } },
        { ...projection.players[1], hand: { visibility: 'private', cards: [] } },
      ],
      legalActions: [],
    })).toBeNull();
    expect(parseMatchPlayerProjection({
      ...projection,
      players: [
        projection.players[0],
        { ...projection.players[1], hand: { visibility: 'private', cards: [] } },
      ],
    })).toBeNull();
    const foreignId = parseBattleCardId('bc_ffffffffffffffffffffffffffffffff');
    if (!foreignId) throw new Error('Expected foreign ID');
    expect(parseMatchPlayerProjection({
      ...projection,
      legalActions: [{ type: 'charge', battleCardId: foreignId }],
    })).toBeNull();
    expect(parseMatchPlayerProjection({
      ...projection,
      activePlayer: 1,
    })).toBeNull();
    expect(parseMatchPlayerProjection({
      ...projection,
      activePlayer: 1,
      phase: 'guard',
    })).toEqual({ ...projection, activePlayer: 1, phase: 'guard' });
    expect(parseMatchPlayerProjection({
      ...projection,
      terminal: { state: 'cancelled', winner: null, reason: 'server_cancelled' },
    })).toBeNull();
    expect(parseMatchPlayerProjection({
      ...projection,
      winner: 0,
      endReason: 'wipeout',
    })).toBeNull();
    expect(parseMatchPlayerProjection({
      ...projection,
      phase: 'finished',
      winner: 1,
      endReason: 'wipeout',
      terminal: { state: 'abandoned', winner: 1, reason: 'player_abandoned' },
      legalActions: [],
    })).toBeNull();
  });
});
