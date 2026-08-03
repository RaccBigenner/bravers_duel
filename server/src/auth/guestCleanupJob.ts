import { runGuestCleanup, type GuestCleanupResult, type GuestCleanupStore } from './guestCleanup';

export interface GuestCleanupJobConfig {
  enabled: boolean;
  dryRun: boolean;
  batchLimit: number;
}

export interface GuestCleanupAudit {
  mode: 'disabled' | 'dry-run' | 'delete';
  result: GuestCleanupResult;
}

const emptyResult = (): GuestCleanupResult => ({ scanned: 0, deleted: 0, skipped: 0, missing: 0 });

/** 定期実行側の安全弁。kill switchとdry-runは削除RPCより前に評価する。 */
export async function runGuestCleanupJob(
  store: GuestCleanupStore,
  config: GuestCleanupJobConfig,
  input: { nowEpochMs: number },
  onAudit?: (audit: GuestCleanupAudit) => void,
): Promise<GuestCleanupResult> {
  if (!Number.isSafeInteger(input.nowEpochMs) || input.nowEpochMs < 0) {
    throw new TypeError('GUEST_CLEANUP_TIME_INVALID');
  }
  if (!Number.isSafeInteger(config.batchLimit) || config.batchLimit < 1 || config.batchLimit > 500) {
    throw new TypeError('GUEST_CLEANUP_LIMIT_INVALID');
  }
  if (!config.enabled) {
    const result = emptyResult();
    onAudit?.({ mode: 'disabled', result });
    return result;
  }
  const candidates = await store.listGuestCandidates({
    cutoffEpochMs: input.nowEpochMs - 90 * 24 * 60 * 60 * 1_000,
    limit: config.batchLimit,
  });
  if (config.dryRun) {
    const result: GuestCleanupResult = {
      scanned: candidates.length,
      deleted: 0,
      skipped: candidates.length,
      missing: 0,
    };
    onAudit?.({ mode: 'dry-run', result });
    return result;
  }
  // runGuestCleanupがlimit/timeを検証し、削除直前の再検査を必ず通す。
  const result = await runGuestCleanup(store, { nowEpochMs: input.nowEpochMs, limit: config.batchLimit });
  onAudit?.({ mode: 'delete', result });
  return result;
}
