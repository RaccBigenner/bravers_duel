import { describe, expect, it } from 'vitest';
import {
  GUEST_RETENTION_MS,
  isExpiredGuestCandidate,
} from '../src/auth/guestRetentionPolicy';

const base = {
  accountId: 'guest-1',
  isAnonymous: true,
  lastActiveAtEpochMs: 1_000,
  hasActiveSession: false,
  hasInProgressBattle: false,
  hasIdentityLinkInProgress: false,
};

describe('guestRetentionPolicy', () => {
  it('expires exactly at 90 days and keeps a recently active guest', () => {
    const now = 1_000 + GUEST_RETENTION_MS;
    expect(isExpiredGuestCandidate(base, now)).toBe(true);
    expect(isExpiredGuestCandidate(base, now - 1)).toBe(false);
  });

  it('fails closed for every protection condition', () => {
    for (const key of ['isAnonymous', 'hasActiveSession', 'hasInProgressBattle', 'hasIdentityLinkInProgress'] as const) {
      const value = { ...base, [key]: key === 'isAnonymous' ? false : true };
      expect(isExpiredGuestCandidate(value, 1_000 + GUEST_RETENTION_MS)).toBe(false);
    }
  });

  it('rejects malformed or ambiguous records instead of deleting them', () => {
    expect(isExpiredGuestCandidate({ ...base, accountId: '' }, 1_000 + GUEST_RETENTION_MS)).toBe(false);
    expect(isExpiredGuestCandidate({ ...base, hasActiveSession: undefined }, 1_000 + GUEST_RETENTION_MS)).toBe(false);
    expect(isExpiredGuestCandidate({ ...base, extra: true }, 1_000 + GUEST_RETENTION_MS)).toBe(false);
    expect(isExpiredGuestCandidate(null, 1_000 + GUEST_RETENTION_MS)).toBe(false);
  });
});
