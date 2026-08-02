import { describe, expect, it } from 'vitest';
import {
  MAX_NPC_START_TOMBSTONES,
  NPC_START_TOMBSTONE_TTL_MS,
  NpcStartIdempotencyLedger,
  isValidNpcStartIdempotencyKey,
} from '../src/session/npcStartIdempotency';

const principal = { accountId: 'account-a', sessionVersion: 1 };

describe('NpcStartIdempotencyLedger', () => {
  it('accepts bounded keys and rejects unsafe/empty keys', () => {
    expect(isValidNpcStartIdempotencyKey('start-01._~')).toBe(true);
    expect(isValidNpcStartIdempotencyKey('')).toBe(false);
    expect(isValidNpcStartIdempotencyKey('bad key')).toBe(false);
    expect(isValidNpcStartIdempotencyKey('あ')).toBe(false);
    expect(isValidNpcStartIdempotencyKey(`a${'x'.repeat(63)}`)).toBe(true);
    expect(isValidNpcStartIdempotencyKey(`a${'x'.repeat(64)}`)).toBe(false);
  });

  it('converges active retries and replays a terminal tombstone without reallocating', () => {
    const ledger = new NpcStartIdempotencyLedger();
    let allocations = 0;
    const allocate = () => ({ matchId: `npc-${++allocations}`, seed: 7 });
    const first = ledger.reserve({ ...principal, idempotencyKey: 'same' }, 100, allocate);
    expect(first.state).toBe('created');
    if (first.state !== 'created') throw new Error('expected created');
    expect(ledger.reserve({ ...principal, idempotencyKey: 'same' }, 101, allocate).state).toBe('active-replay');
    expect(allocations).toBe(1);
    expect(ledger.release({ ...first.reservation }, 200)).toBe(true);
    const replay = ledger.reserve({ ...principal, idempotencyKey: 'same' }, 201, allocate);
    expect(replay.state).toBe('released-replay');
    expect(allocations).toBe(1);
  });

  it('does not confuse principals, refuses a full bounded tombstone set, and expires at the TTL boundary', () => {
    const ledger = new NpcStartIdempotencyLedger();
    const allocate = (now: number) => ({ matchId: `npc-${now}`, seed: now });
    const first = ledger.reserve({ ...principal, idempotencyKey: 'old' }, 1, allocate);
    if (first.state !== 'created') throw new Error('expected created');
    expect(ledger.release({ ...first.reservation }, 2)).toBe(true);
    expect(ledger.reserve({ accountId: 'account-b', sessionVersion: 1, idempotencyKey: 'old' }, 3, allocate).state).toBe('conflict');
    for (let index = 0; index < MAX_NPC_START_TOMBSTONES - 1; index += 1) {
      const key = `key-${index}`;
      const created = ledger.reserve({ ...principal, idempotencyKey: key }, 10 + index, allocate);
      if (created.state !== 'created') throw new Error('expected created');
      expect(ledger.release({ ...created.reservation }, 20 + index)).toBe(true);
    }
    expect(ledger.reserve({ ...principal, idempotencyKey: 'capacity' }, 100, allocate).state).toBe('capacity');
    expect(ledger.reserve({ ...principal, idempotencyKey: 'old' }, 2 + NPC_START_TOMBSTONE_TTL_MS, allocate).state).toBe('created');
  });
});
