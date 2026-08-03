import {
  GUEST_RETENTION_MS,
  isExpiredGuestCandidate,
  type GuestRetentionCandidate,
} from './guestRetentionPolicy';

export type GuestCleanupOutcome = 'deleted' | 'skipped' | 'missing';

/**
 * 候補の列挙と削除直前の再検査を分離する。deleteIfEligibleはDB側で
 * SELECT ... FOR UPDATE相当のtransactionを持ち、活動更新との競合時は必ずskipする。
 */
export interface GuestCleanupStore {
  listGuestCandidates(input: { cutoffEpochMs: number; limit: number }): Promise<readonly GuestRetentionCandidate[]>;
  deleteIfEligible(input: {
    accountId: string;
    cutoffEpochMs: number;
    nowEpochMs: number;
  }): Promise<GuestCleanupOutcome>;
}

export interface GuestCleanupResult {
  scanned: number;
  deleted: number;
  skipped: number;
  missing: number;
}

export async function runGuestCleanup(
  store: GuestCleanupStore,
  input: { nowEpochMs: number; limit: number },
): Promise<GuestCleanupResult> {
  if (!Number.isSafeInteger(input.nowEpochMs) || input.nowEpochMs < 0) {
    throw new TypeError('GUEST_CLEANUP_TIME_INVALID');
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) {
    throw new TypeError('GUEST_CLEANUP_LIMIT_INVALID');
  }
  const cutoffEpochMs = input.nowEpochMs - GUEST_RETENTION_MS;
  const candidates = await store.listGuestCandidates({ cutoffEpochMs, limit: input.limit });
  const result: GuestCleanupResult = { scanned: 0, deleted: 0, skipped: 0, missing: 0 };
  for (const candidate of candidates) {
    result.scanned += 1;
    // 列挙結果そのものも検査する。壊れた候補をstoreへ渡さない。
    if (!isExpiredGuestCandidate(candidate, input.nowEpochMs)) {
      result.skipped += 1;
      continue;
    }
    const outcome = await store.deleteIfEligible({
      accountId: candidate.accountId,
      cutoffEpochMs,
      nowEpochMs: input.nowEpochMs,
    });
    result[outcome] += 1;
  }
  return result;
}
