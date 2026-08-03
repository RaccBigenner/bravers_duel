import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/auth/sessionCrypto', () => ({
  tokenDigestCandidates: vi.fn(async () => [{ keyVersion: 2, digestHex: 'aa'.repeat(32) }]),
}));
import { lookupOpaqueSessionToken } from '../src/auth/sessionAuthentication';
import type { SessionStore } from '../src/auth/supabaseSessionStore';

const accountId = '11111111-2222-4333-8444-555555555555';
const sessionId = '22222222-3333-4444-8555-666666666666';
const principal = {
  sessionId,
  accountId,
  sessionVersion: 1,
  idleExpiresAt: '2026-08-03T00:00:00.000Z',
  absoluteExpiresAt: '2027-08-03T00:00:00.000Z',
  credentialState: 'CURRENT' as const,
  credentialKeyVersion: 2,
};

const keys = {} as never;

function store(overrides: Partial<SessionStore> = {}): SessionStore {
  return {
    resolveSessionCandidates: vi.fn(async () => principal),
    ...overrides,
  } as SessionStore;
}

describe('lookupOpaqueSessionToken activity wiring', () => {
  it('touch成功時だけreadyを返す', async () => {
    const touch = vi.fn(async () => true);
    const result = await lookupOpaqueSessionToken('token', store({ touchAccountLastActive: touch }), keys);
    expect(result.state).toBe('ready');
    expect(touch).toHaveBeenCalledWith(accountId);
  });

  it('account行が消えてtouchがfalseならintegrity_failureで止める', async () => {
    const touch = vi.fn(async () => false);
    const result = await lookupOpaqueSessionToken('token', store({ touchAccountLastActive: touch }), keys);
    expect(result).toEqual({ state: 'integrity_failure' });
  });

  it('旧storeでtouch未実装なら互換的にreadyを返す', async () => {
    const result = await lookupOpaqueSessionToken('token', store(), keys);
    expect(result.state).toBe('ready');
  });
});
