import { describe, expect, it, vi } from 'vitest';
import { GUEST_RETENTION_MS } from '../src/auth/guestRetentionPolicy';
import { runGuestCleanupJob } from '../src/auth/guestCleanupJob';

const candidate = {
  accountId: 'guest-1', isAnonymous: true, lastActiveAtEpochMs: 1_000,
  hasProtectedValue: false,
  hasActiveSession: false, hasInProgressBattle: false, hasIdentityLinkInProgress: false,
};

describe('guestCleanupJob', () => {
  it('kill switchは候補取得・削除を一切呼ばず監査する', async () => {
    const store = { listGuestCandidates: vi.fn(), deleteIfEligible: vi.fn() };
    const audit = vi.fn();
    await expect(runGuestCleanupJob(store, { enabled: false, dryRun: false, batchLimit: 10 }, { nowEpochMs: 1 }, audit))
      .resolves.toEqual({ scanned: 0, deleted: 0, skipped: 0, missing: 0 });
    expect(store.listGuestCandidates).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith({ mode: 'disabled', result: { scanned: 0, deleted: 0, skipped: 0, missing: 0 } });
  });

  it('dry-runは候補を数えるだけで削除RPCを呼ばない', async () => {
    const store = {
      listGuestCandidates: vi.fn(async () => [candidate]),
      deleteIfEligible: vi.fn(),
    };
    const audit = vi.fn();
    const result = await runGuestCleanupJob(store, { enabled: true, dryRun: true, batchLimit: 10 }, { nowEpochMs: 1_000 + GUEST_RETENTION_MS }, audit);
    expect(result).toEqual({ scanned: 1, deleted: 0, skipped: 1, missing: 0 });
    expect(store.deleteIfEligible).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith({ mode: 'dry-run', result });
  });

  it('delete modeはbatch上限をrunGuestCleanupへ渡し結果を監査する', async () => {
    const store = {
      listGuestCandidates: vi.fn(async () => [candidate]),
      deleteIfEligible: vi.fn(async () => 'deleted' as const),
    };
    const audit = vi.fn();
    const result = await runGuestCleanupJob(store, { enabled: true, dryRun: false, batchLimit: 7 }, { nowEpochMs: 1_000 + GUEST_RETENTION_MS }, audit);
    expect(result.deleted).toBe(1);
    expect(store.listGuestCandidates).toHaveBeenCalledWith({ cutoffEpochMs: 1_000, limit: 7 });
    expect(audit).toHaveBeenCalledWith({ mode: 'delete', result });
  });
});
