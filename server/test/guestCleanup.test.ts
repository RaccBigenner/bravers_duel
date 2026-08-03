import { describe, expect, it, vi } from 'vitest';
import { GUEST_RETENTION_MS } from '../src/auth/guestRetentionPolicy';
import { runGuestCleanup, type GuestCleanupStore } from '../src/auth/guestCleanup';

const now = 10_000 + GUEST_RETENTION_MS;
const expired = {
  accountId: 'guest-1', isAnonymous: true, lastActiveAtEpochMs: 10_000,
  hasActiveSession: false, hasInProgressBattle: false, hasIdentityLinkInProgress: false,
};

describe('guestCleanup', () => {
  it('rechecks each candidate through the atomic store boundary and counts outcomes', async () => {
    const deleteIfEligible = vi.fn()
      .mockResolvedValueOnce('deleted')
      .mockResolvedValueOnce('skipped')
      .mockResolvedValueOnce('missing');
    const store: GuestCleanupStore = {
      listGuestCandidates: async () => [
        expired,
        { ...expired, accountId: 'guest-2' },
        { ...expired, accountId: 'guest-3' },
      ],
      deleteIfEligible,
    };
    await expect(runGuestCleanup(store, { nowEpochMs: now, limit: 10 })).resolves.toEqual({
      scanned: 3, deleted: 1, skipped: 1, missing: 1,
    });
    expect(deleteIfEligible).toHaveBeenCalledTimes(3);
    expect(deleteIfEligible).toHaveBeenCalledWith({ accountId: 'guest-1', cutoffEpochMs: 10_000, nowEpochMs: now });
  });

  it('does not send malformed or protected candidates to the delete transaction', async () => {
    const deleteIfEligible = vi.fn();
    const store: GuestCleanupStore = {
      listGuestCandidates: async () => [
        { ...expired, hasActiveSession: true },
        { ...expired, accountId: '' },
      ],
      deleteIfEligible,
    };
    await expect(runGuestCleanup(store, { nowEpochMs: now, limit: 2 })).resolves.toEqual({
      scanned: 2, deleted: 0, skipped: 2, missing: 0,
    });
    expect(deleteIfEligible).not.toHaveBeenCalled();
  });

  it('rejects unsafe limits and times before touching storage', async () => {
    const store = { listGuestCandidates: vi.fn(), deleteIfEligible: vi.fn() } as unknown as GuestCleanupStore;
    await expect(runGuestCleanup(store, { nowEpochMs: -1, limit: 1 })).rejects.toThrow('GUEST_CLEANUP_TIME_INVALID');
    await expect(runGuestCleanup(store, { nowEpochMs: 1, limit: 501 })).rejects.toThrow('GUEST_CLEANUP_LIMIT_INVALID');
    expect(store.listGuestCandidates).not.toHaveBeenCalled();
  });

  it('activity更新が削除直前に競合した場合はstoreがskipを返し、監査集計も削除0になる', async () => {
    let activityUpdated = false;
    const store: GuestCleanupStore = {
      listGuestCandidates: async () => {
        activityUpdated = true;
        return [expired];
      },
      deleteIfEligible: async () => (activityUpdated ? 'skipped' : 'deleted'),
    };
    await expect(runGuestCleanup(store, { nowEpochMs: now, limit: 1 })).resolves.toEqual({
      scanned: 1, deleted: 0, skipped: 1, missing: 0,
    });
  });
});
