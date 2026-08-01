import {
  MATCH_PLAYER_PROJECTION_VERSION,
  MATCH_VIEWER_EVENT_VERSION,
  parseMatchId,
  type MatchId,
} from '@bravers/protocol';

const CURSOR_KEY = 'bravers-duel:match-resume:v2';
const DISMISSED_KEY = 'bravers-duel:dismissed-terminal:v1';

export interface RecoveryStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredCursor {
  matchId: MatchId;
  seat: 'player-1';
  projectionVersion: typeof MATCH_PLAYER_PROJECTION_VERSION;
  viewerEventVersion: typeof MATCH_VIEWER_EVENT_VERSION;
  eventSequence: number;
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const actual = Object.keys(candidate);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(candidate, key));
}

function parseStoredCursor(raw: string | null): StoredCursor | null {
  if (raw === null || raw.length > 512) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (
    !exactRecord(value, [
      'matchId',
      'seat',
      'projectionVersion',
      'viewerEventVersion',
      'eventSequence',
    ]) ||
    value.seat !== 'player-1' ||
    value.projectionVersion !== MATCH_PLAYER_PROJECTION_VERSION ||
    value.viewerEventVersion !== MATCH_VIEWER_EVENT_VERSION ||
    !Number.isSafeInteger(value.eventSequence) ||
    Number(value.eventSequence) < 0
  ) {
    return null;
  }
  const matchId = parseMatchId(value.matchId);
  return matchId
    ? {
        matchId,
        seat: 'player-1',
        projectionVersion: MATCH_PLAYER_PROJECTION_VERSION,
        viewerEventVersion: MATCH_VIEWER_EVENT_VERSION,
        eventSequence: value.eventSequence as number,
      }
    : null;
}

export class MatchRecoveryStorage {
  constructor(private readonly storage: RecoveryStorageLike | null) {}

  readCursor(matchId: MatchId): number {
    try {
      const stored = parseStoredCursor(this.storage?.getItem(CURSOR_KEY) ?? null);
      return stored?.matchId === matchId ? stored.eventSequence : 0;
    } catch {
      return 0;
    }
  }

  hasValidCursor(): boolean {
    try {
      return parseStoredCursor(this.storage?.getItem(CURSOR_KEY) ?? null) !== null;
    } catch {
      return false;
    }
  }

  writeCursor(matchId: MatchId, eventSequence: number): void {
    if (!Number.isSafeInteger(eventSequence) || eventSequence < 0) return;
    const value: StoredCursor = {
      matchId,
      seat: 'player-1',
      projectionVersion: MATCH_PLAYER_PROJECTION_VERSION,
      viewerEventVersion: MATCH_VIEWER_EVENT_VERSION,
      eventSequence,
    };
    try {
      this.storage?.setItem(CURSOR_KEY, JSON.stringify(value));
    } catch {
      // Private modeやquota errorでも、現在の接続はmemory cursorで継続できる。
    }
  }

  clearCursor(matchId?: MatchId): void {
    try {
      if (matchId) {
        const stored = parseStoredCursor(this.storage?.getItem(CURSOR_KEY) ?? null);
        if (stored && stored.matchId !== matchId) return;
      }
      this.storage?.removeItem(CURSOR_KEY);
    } catch {
      // storageは復帰の最適化であり、失敗を対戦本体へ波及させない。
    }
  }

  isTerminalDismissed(matchId: MatchId): boolean {
    try {
      return this.storage?.getItem(DISMISSED_KEY) === matchId;
    } catch {
      return false;
    }
  }

  dismissTerminal(matchId: MatchId): void {
    try {
      this.storage?.setItem(DISMISSED_KEY, matchId);
    } catch {
      // 表示上の補助状態なので失敗しても安全。
    }
  }
}
