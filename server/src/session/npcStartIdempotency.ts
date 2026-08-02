/**
 * NPC対戦開始の再送を、HTTP/Coordinatorの実装から独立して検証する小さな台帳。
 * Durable Objectのtransaction内で同じ判定を行うため、時刻とID生成を注入する。
 */

export const NPC_START_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,63}$/;
export const NPC_START_TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1_000;
export const MAX_NPC_START_TOMBSTONES = 16;

export interface NpcStartPrincipal {
  accountId: string;
  sessionVersion: number;
}

export interface NpcStartReservation extends NpcStartPrincipal {
  idempotencyKey: string;
  matchId: string;
  seed: number;
  createdAtEpochMs: number;
}

export interface NpcStartTombstone extends NpcStartReservation {
  releasedAtEpochMs: number;
}

export type NpcStartReserveResult =
  | { state: 'created'; reservation: NpcStartReservation }
  | { state: 'active-replay'; reservation: NpcStartReservation }
  | { state: 'released-replay'; tombstone: NpcStartTombstone }
  | { state: 'conflict' }
  | { state: 'capacity' };

export function isValidNpcStartIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && NPC_START_IDEMPOTENCY_KEY_PATTERN.test(value);
}

function samePrincipal(a: NpcStartPrincipal, b: NpcStartPrincipal): boolean {
  return a.accountId === b.accountId && a.sessionVersion === b.sessionVersion;
}

/** Coordinator transaction内で使うbounded active+tombstone台帳。 */
export class NpcStartIdempotencyLedger {
  private active: NpcStartReservation | undefined;
  private readonly tombstones: NpcStartTombstone[] = [];

  reserve(
    input: NpcStartPrincipal & { idempotencyKey: string },
    nowEpochMs: number,
    allocate: (nowEpochMs: number) => Pick<NpcStartReservation, 'matchId' | 'seed'>,
  ): NpcStartReserveResult {
    if (!isValidNpcStartIdempotencyKey(input.idempotencyKey)) return { state: 'conflict' };
    this.prune(nowEpochMs);

    if (this.active !== undefined) {
      if (!samePrincipal(this.active, input) || this.active.idempotencyKey !== input.idempotencyKey) {
        return { state: 'conflict' };
      }
      return { state: 'active-replay', reservation: this.active };
    }

    const tombstone = this.tombstones.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (tombstone !== undefined) {
      return samePrincipal(tombstone, input)
        ? { state: 'released-replay', tombstone }
        : { state: 'conflict' };
    }
    if (this.tombstones.length >= MAX_NPC_START_TOMBSTONES) return { state: 'capacity' };

    const generated = allocate(nowEpochMs);
    this.active = {
      ...input,
      ...generated,
      createdAtEpochMs: nowEpochMs,
    };
    return { state: 'created', reservation: this.active };
  }

  release(input: NpcStartPrincipal & { idempotencyKey: string; matchId: string; seed: number }, nowEpochMs: number): boolean {
    if (this.active === undefined || !samePrincipal(this.active, input) ||
      this.active.idempotencyKey !== input.idempotencyKey || this.active.matchId !== input.matchId ||
      this.active.seed !== input.seed) return false;
    this.tombstones.push({ ...this.active, releasedAtEpochMs: nowEpochMs });
    this.active = undefined;
    return true;
  }

  snapshot(): { active?: NpcStartReservation; tombstones: NpcStartTombstone[] } {
    return { active: this.active, tombstones: [...this.tombstones] };
  }

  private prune(nowEpochMs: number): void {
    const cutoff = nowEpochMs - NPC_START_TOMBSTONE_TTL_MS;
    for (let index = this.tombstones.length - 1; index >= 0; index -= 1) {
      if (this.tombstones[index]!.releasedAtEpochMs <= cutoff) this.tombstones.splice(index, 1);
    }
  }
}
