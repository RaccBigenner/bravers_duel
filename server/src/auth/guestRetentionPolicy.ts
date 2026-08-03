/** 休眠ゲスト削除の候補判定。DB transactionの再検査前提で、曖昧な値は必ず残す。 */
export const GUEST_RETENTION_MS = 365 * 24 * 60 * 60 * 1_000;

export interface GuestRetentionCandidate {
  accountId: string;
  isAnonymous: boolean;
  hasProtectedValue: boolean;
  lastActiveAtEpochMs: number;
  hasActiveSession: boolean;
  hasInProgressBattle: boolean;
  hasIdentityLinkInProgress: boolean;
}

export function isExpiredGuestCandidate(
  value: unknown,
  nowEpochMs: number,
): value is GuestRetentionCandidate {
  if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0 || !isCandidateShape(value)) {
    return false;
  }
  return (
    value.isAnonymous &&
    !value.hasProtectedValue &&
    value.lastActiveAtEpochMs <= nowEpochMs - GUEST_RETENTION_MS &&
    !value.hasActiveSession &&
    !value.hasInProgressBattle &&
    !value.hasIdentityLinkInProgress
  );
}

function isCandidateShape(value: unknown): value is GuestRetentionCandidate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 7 &&
    typeof candidate.accountId === 'string' && candidate.accountId.length > 0 &&
    typeof candidate.isAnonymous === 'boolean' &&
    typeof candidate.hasProtectedValue === 'boolean' &&
    typeof candidate.lastActiveAtEpochMs === 'number' &&
    Number.isSafeInteger(candidate.lastActiveAtEpochMs) && candidate.lastActiveAtEpochMs >= 0 &&
    typeof candidate.hasActiveSession === 'boolean' &&
    typeof candidate.hasInProgressBattle === 'boolean' &&
    typeof candidate.hasIdentityLinkInProgress === 'boolean'
  );
}
