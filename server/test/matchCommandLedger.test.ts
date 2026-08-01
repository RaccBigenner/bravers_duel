import {
  parseMatchCommandId,
  parseMatchId,
  parseMatchRevision,
  type MatchCommandCandidate,
  type MatchRevision,
} from '@bravers/protocol';
import { describe, expect, it } from 'vitest';
import {
  MAX_MATCH_COMMAND_RECORDS,
  MAX_MATCH_COMMAND_REJECTION_RECORDS,
  MatchCommandLedger,
  MatchCommandLedgerError,
  MatchCommandPayloadError,
  identifyMatchCommandPayload,
} from '../src/match/matchCommandLedger';

function candidate(overrides: Partial<MatchCommandCandidate> = {}): MatchCommandCandidate {
  const matchId = parseMatchId('npc-00112233-4455-4677-8899-aabbccddeeff');
  const commandId = parseMatchCommandId('cmd_00112233445566778899aabbccddeeff');
  const expectedRevision = parseMatchRevision(0);
  if (!matchId || !commandId || expectedRevision === null) throw new Error('Invalid fixture');
  return {
    matchId,
    commandId,
    expectedRevision,
    action: { type: 'endPlay' },
    ...overrides,
  };
}

function revision(value: number): MatchRevision {
  const parsed = parseMatchRevision(value);
  if (parsed === null) throw new Error('Invalid revision fixture');
  return parsed;
}

function commandId(value: number) {
  const parsed = parseMatchCommandId(`cmd_${value.toString(16).padStart(32, '0')}`);
  if (!parsed) throw new Error('Invalid command ID fixture');
  return parsed;
}

describe('OLG-122 MatchCommandLedger', () => {
  it('key順を正規化し、seat/revision/actionの差をSHA-256 identityへ束縛する', async () => {
    const first = candidate({
      action: {
        type: 'playSkill',
        targetSlot: 1,
        battleCardId: 'bc_00112233445566778899aabbccddeeff',
      },
    });
    const reordered = candidate({
      action: {
        battleCardId: 'bc_00112233445566778899aabbccddeeff',
        targetSlot: 1,
        type: 'playSkill',
      },
    });
    const firstIdentity = await identifyMatchCommandPayload(first, 'player-1');
    const reorderedIdentity = await identifyMatchCommandPayload(reordered, 'player-1');
    expect(reorderedIdentity).toEqual(firstIdentity);
    expect(firstIdentity.payloadDigest).toMatch(/^[0-9a-f]{64}$/);

    const otherSeat = await identifyMatchCommandPayload(first, 'player-2');
    const otherRevision = await identifyMatchCommandPayload(
      candidate({ expectedRevision: revision(1), action: first.action }),
      'player-1',
    );
    const otherAction = await identifyMatchCommandPayload(
      candidate({ action: { type: 'skipTurnStart' } }),
      'player-1',
    );
    expect(
      new Set([
        firstIdentity.payloadDigest,
        otherSeat.payloadDigest,
        otherRevision.payloadDigest,
        otherAction.payloadDigest,
      ]).size,
    ).toBe(4);
  });

  it('循環・非JSON値・custom prototype・上限超過をadmission前に拒否する', async () => {
    const cyclic: Record<string, unknown> = { type: 'endPlay' };
    cyclic.self = cyclic;
    const custom = Object.assign(Object.create({ inherited: true }), { type: 'endPlay' });
    const sparse = new Array(1);
    const arrayWithExtra = Object.assign([] as unknown[], { extra: true });
    const nonEnumerableIndex: unknown[] = [];
    Object.defineProperty(nonEnumerableIndex, '0', {
      value: null,
      enumerable: false,
      configurable: true,
    });
    const arrayWithHiddenExtra: unknown[] = [];
    Object.defineProperty(arrayWithHiddenExtra, 'extra', {
      value: true,
      enumerable: false,
      configurable: true,
    });
    const objectWithHiddenExtra: Record<string, unknown> = { type: 'endPlay' };
    Object.defineProperty(objectWithHiddenExtra, 'extra', {
      value: true,
      enumerable: false,
      configurable: true,
    });
    const objectWithSymbol = { type: 'endPlay', [Symbol('extra')]: true };
    const tooManyObjectKeys = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`key-${index}`, null]),
    );
    for (const action of [
      cyclic,
      { type: 'playSkill', targetSlot: undefined },
      { type: 'playSkill', targetSlot: Number.NaN },
      { type: 'playSkill', callback: () => undefined },
      custom,
      { type: 'playSkill', value: 'x'.repeat(513) },
      Array.from({ length: 65 }, () => null),
      sparse,
      arrayWithExtra,
      nonEnumerableIndex,
      arrayWithHiddenExtra,
      objectWithHiddenExtra,
      objectWithSymbol,
      tooManyObjectKeys,
    ]) {
      await expect(
        identifyMatchCommandPayload(candidate({ action }), 'player-1'),
      ).rejects.toBeInstanceOf(MatchCommandPayloadError);
    }

    await expect(
      identifyMatchCommandPayload(candidate({ action: [null, { dense: true }] }), 'player-1'),
    ).resolves.toMatchObject({
      canonicalPayload: expect.stringContaining('[null,{"dense":true}]'),
    });
  });

  it('同一ID・同一payloadだけをclone replayし、別payloadを衝突にする', async () => {
    const command = candidate();
    const identity = await identifyMatchCommandPayload(command, 'player-1');
    const ledger = new MatchCommandLedger<{
      state: 'accepted' | 'rejected';
      revision: MatchRevision;
      nested: { value: number };
    }>(2);
    const original = { state: 'accepted' as const, revision: revision(1), nested: { value: 1 } };
    const remembered = ledger.remember(command.commandId, identity, original);
    original.nested.value = 99;
    remembered.nested.value = 98;

    expect(ledger.lookup(command.commandId, identity)).toEqual({
      state: 'replay',
      result: { state: 'accepted', revision: 1, nested: { value: 1 } },
    });
    const different = await identifyMatchCommandPayload(
      candidate({ action: { type: 'endTurn' } }),
      'player-1',
    );
    expect(ledger.lookup(command.commandId, different)).toEqual({
      state: 'conflict',
      originalRevision: 1,
    });
    expect(ledger.size).toBe(1);
  });

  it('duplicate登録とbounded capacityをfail closedにする', async () => {
    const first = candidate();
    const firstIdentity = await identifyMatchCommandPayload(first, 'player-1');
    const ledger = new MatchCommandLedger<{
      state: 'accepted' | 'rejected';
      revision: MatchRevision;
    }>(1);
    ledger.remember(first.commandId, firstIdentity, {
      state: 'accepted',
      revision: revision(0),
    });
    expect(() =>
      ledger.remember(first.commandId, firstIdentity, {
        state: 'accepted',
        revision: revision(0),
      }),
    ).toThrowError(new MatchCommandLedgerError('MATCH_COMMAND_DUPLICATE'));

    const secondId = parseMatchCommandId('cmd_ffeeddccbbaa99887766554433221100');
    if (!secondId) throw new Error('Invalid second command ID');
    const second = candidate({ commandId: secondId });
    const secondIdentity = await identifyMatchCommandPayload(second, 'player-1');
    expect(() =>
      ledger.remember(secondId, secondIdentity, {
        state: 'accepted',
        revision: revision(0),
      }),
    ).toThrowError(new MatchCommandLedgerError('MATCH_COMMAND_CAPACITY_EXCEEDED'));
  });

  it('拒否枠を全体と分離し、上限後もaccepted容量を確保してclearでresetする', async () => {
    expect(MAX_MATCH_COMMAND_RECORDS).toBe(2_048);
    expect(MAX_MATCH_COMMAND_REJECTION_RECORDS).toBe(512);

    type Result = {
      state: 'accepted' | 'rejected';
      revision: MatchRevision;
    };
    const ledger = new MatchCommandLedger<Result>(4, 1);
    const identity = await identifyMatchCommandPayload(candidate(), 'player-1');
    const rejected: Result = { state: 'rejected', revision: revision(0) };
    const accepted: Result = { state: 'accepted', revision: revision(1) };

    ledger.remember(commandId(1), identity, rejected);
    expect(ledger.rejectedSize).toBe(1);
    expect(ledger.hasCapacity('rejected')).toBe(false);
    expect(ledger.hasCapacity('accepted')).toBe(true);
    expect(() => ledger.remember(commandId(2), identity, rejected)).toThrowError(
      new MatchCommandLedgerError('MATCH_COMMAND_REJECTION_CAPACITY_EXCEEDED'),
    );
    expect(ledger.size).toBe(1);

    ledger.remember(commandId(2), identity, accepted);
    ledger.remember(commandId(3), identity, accepted);
    ledger.remember(commandId(4), identity, accepted);
    expect(ledger.size).toBe(4);
    expect(ledger.rejectedSize).toBe(1);
    expect(ledger.hasCapacity()).toBe(false);

    ledger.clear();
    expect(ledger.size).toBe(0);
    expect(ledger.rejectedSize).toBe(0);
    expect(ledger.hasCapacity('rejected')).toBe(true);
    expect(ledger.remember(commandId(1), identity, rejected)).toEqual(rejected);
  });
});
