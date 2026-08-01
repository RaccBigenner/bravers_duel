import { DurableObject } from 'cloudflare:workers';
import { createSessionRuntimeConfig } from '../auth/sessionRuntimeConfig';
import {
  SessionStoreError,
  SupabaseSessionStore,
} from '../auth/supabaseSessionStore';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const LOGOUT_WORK_KEY = 'logout-work-v1';
const INVALIDATION_FLOOR_KEY = 'invalidation-floor-v1';
const MATCH_REFERENCES_KEY = 'match-references-v1';
// v1はsession全体で1本のfloorだった。v2はmatchId単位に分離し、無関係な別matchの
// 初回登録を巻き込まないようにする（v1の値は新schemaと形が違うため読み捨てる）。
const CANCELLED_REGISTRATION_FLOOR_KEY = 'cancelled-match-registration-floor-v2';
const ACTIVE_NPC_MATCH_RESERVATION_KEY = 'active-npc-match-reservation-v1';
const RECENT_NPC_MATCH_RECOVERY_KEY = 'recent-npc-match-recovery-v1';
const LOGOUT_REASON = 'LOGOUT';

export const MAX_SESSION_MATCH_REFERENCES = 16;
export const MAX_SESSION_MATCH_REGISTRATIONS_PER_MATCH = 8;
export const MAX_TRACKED_CANCELLED_MATCH_FLOORS = 64;
export const LOGOUT_RECOVERY_DELAY_MS = 5_000;
export const INVALIDATION_RETRY_BASE_MS = 1_000;
export const INVALIDATION_RETRY_MAX_MS = 60_000;
export const NPC_MATCH_RECOVERY_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

interface MatchReference {
  matchId: string;
  sessionVersion: number;
  registrationId: string;
  registrationEpochMs: number;
}

interface ActiveNpcMatchReservation {
  accountId: string;
  sessionVersion: number;
  matchId: string;
  seed: number;
  createdAtEpochMs: number;
}

interface RecentNpcMatchRecoveryOwnership {
  accountId: string;
  sessionVersion: number;
  matchId: string;
  seed: number;
  releasedAtEpochMs: number;
}

interface CancelledRegistrationFloor {
  registrationEpochMs: number;
  updatedAtEpochMs: number;
}

/** matchIdごとのfloor。無関係なmatchのregisterMatchを巻き込まないようscopeする。 */
type CancelledRegistrationFloorsByMatch = Record<string, CancelledRegistrationFloor>;

interface InvalidationFloor {
  invalidatedVersion: number;
  updatedAtEpochMs: number;
}

interface RevokePendingWork {
  phase: 'revoke_pending';
  accountId: string;
  sessionVersion: number;
  sessionDigestHex: string;
  sessionDigestKeyVersion: number;
  retryAttempt: number;
  lastErrorCode?: string;
  createdAtEpochMs: number;
}

interface FanoutPendingWork {
  phase: 'fanout_pending';
  source: 'logout' | 'direct';
  accountId?: string;
  sessionVersion?: number;
  invalidatedVersion: number;
  retryAttempt: number;
  lastErrorCode?: string;
  createdAtEpochMs: number;
}

type LogoutWork = RevokePendingWork | FanoutPendingWork;

export type SessionMatchRegistrationResult =
  | { state: 'registered' }
  | { state: 'invalidated'; invalidatedVersion: number }
  | { state: 'cancelled'; cancelledThroughEpochMs: number }
  | { state: 'capacity_exceeded' };

export type SessionMatchReferenceStatus =
  | { state: 'registered' }
  | { state: 'invalidated'; invalidatedVersion: number }
  | { state: 'missing' };

export type SessionMatchMembershipStatus =
  | { state: 'registered' }
  | { state: 'invalidated'; invalidatedVersion: number }
  | { state: 'missing' };

export type SessionNpcMatchReservationResult =
  | { state: 'reserved'; matchId: string; seed: number; created: boolean }
  | { state: 'invalidated'; invalidatedVersion: number }
  | { state: 'conflict' };

export type SessionNpcMatchReleaseResult =
  | { state: 'released' }
  | { state: 'missing' }
  | { state: 'references_remain' }
  | { state: 'conflict' };

export type SessionNpcMatchReadResult =
  | { state: 'located'; matchId: string }
  | { state: 'none' }
  | { state: 'invalidated'; invalidatedVersion: number }
  | { state: 'conflict' };

export type SessionNpcMatchRecoveryOwnershipStatus =
  | { state: 'authorized' }
  | { state: 'missing' }
  | { state: 'invalidated'; invalidatedVersion: number }
  | { state: 'conflict' };

export type SessionLogoutPreparationResult =
  | { state: 'prepared' }
  | { state: 'fanout_pending'; invalidatedVersion: number }
  | { state: 'already_completed'; invalidatedVersion: number }
  | { state: 'conflict' };

export type SessionInvalidationResult =
  | { state: 'acknowledged'; invalidatedVersion: number; matchedObjects: number }
  | { state: 'pending'; invalidatedVersion: number; pendingObjects: number };

export interface SessionLogoutIntent {
  sessionId: string;
  accountId: string;
  sessionVersion: number;
  sessionDigestHex: string;
  sessionDigestKeyVersion: number;
}

export interface SessionLogoutConfirmation extends SessionLogoutIntent {
  invalidatedVersion: number;
}

export interface SessionMatchReferenceInput {
  sessionId: string;
  sessionVersion: number;
  matchId: string;
  registrationId: string;
  registrationEpochMs: number;
}

export interface SessionMatchMembershipInput {
  sessionId: string;
  sessionVersion: number;
  matchId: string;
}

export interface SessionNpcMatchReservationInput {
  sessionId: string;
  accountId: string;
  sessionVersion: number;
}

export interface SessionNpcMatchRecoveryOwnershipInput
  extends SessionNpcMatchReservationInput {
  matchId: string;
}

export interface SessionNpcMatchReleaseInput extends SessionNpcMatchReservationInput {
  matchId: string;
  seed: number;
}

export interface SessionCoordinatorPort {
  registerMatch(
    input: SessionMatchReferenceInput,
  ): Promise<SessionMatchRegistrationResult>;
  checkMatch(input: SessionMatchReferenceInput): Promise<SessionMatchReferenceStatus>;
  checkMatchMembership(
    input: SessionMatchMembershipInput,
  ): Promise<SessionMatchMembershipStatus>;
  reserveNpcMatch(
    input: SessionNpcMatchReservationInput,
  ): Promise<SessionNpcMatchReservationResult>;
  readNpcMatch(input: SessionNpcMatchReservationInput): Promise<SessionNpcMatchReadResult>;
  checkNpcMatchRecoveryOwnership(
    input: SessionNpcMatchRecoveryOwnershipInput,
  ): Promise<SessionNpcMatchRecoveryOwnershipStatus>;
  releaseNpcMatch(
    input: SessionNpcMatchReleaseInput,
  ): Promise<SessionNpcMatchReleaseResult>;
  unregisterMatch(
    input: SessionMatchReferenceInput,
  ): Promise<{ state: 'acknowledged' }>;
  prepareLogout(input: SessionLogoutIntent): Promise<SessionLogoutPreparationResult>;
  confirmLogout(input: SessionLogoutConfirmation): Promise<SessionInvalidationResult>;
  invalidateSession(input: {
    sessionId: string;
    invalidatedVersion: number;
  }): Promise<SessionInvalidationResult>;
}

interface MatchInvalidationPort {
  invalidateSession(input: {
    sessionId: string;
    invalidatedVersion: number;
  }): Promise<{ state: 'acknowledged'; closedConnections: number }>;
}

interface MatchNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): MatchInvalidationPort;
}

export interface SessionCoordinatorNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): SessionCoordinatorPort;
}

export interface SessionCoordinatorBindings {
  SESSION_COORDINATOR_DO?: SessionCoordinatorNamespace;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function plainExactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function validateIdentity(objectName: string | undefined, sessionId: string): void {
  if (!UUID_PATTERN.test(sessionId) || objectName !== sessionId) {
    throw new TypeError('SESSION_COORDINATOR_IDENTITY_INVALID');
  }
}

function validateReferenceInput(input: SessionMatchReferenceInput): void {
  if (
    !UUID_PATTERN.test(input.sessionId) ||
    !positiveInteger(input.sessionVersion) ||
    !MATCH_ID_PATTERN.test(input.matchId) ||
    !UUID_PATTERN.test(input.registrationId) ||
    !positiveInteger(input.registrationEpochMs) ||
    input.registrationEpochMs > Date.now() + 60_000
  ) {
    throw new TypeError('SESSION_MATCH_REFERENCE_INVALID');
  }
}

function validateMembershipInput(input: SessionMatchMembershipInput): void {
  if (
    !plainExactObject(input, ['sessionId', 'sessionVersion', 'matchId']) ||
    typeof input.sessionId !== 'string' ||
    !UUID_PATTERN.test(input.sessionId) ||
    !positiveInteger(input.sessionVersion) ||
    typeof input.matchId !== 'string' ||
    !MATCH_ID_PATTERN.test(input.matchId)
  ) {
    throw new TypeError('SESSION_MATCH_MEMBERSHIP_INVALID');
  }
}

function validateNpcReservationInput(input: SessionNpcMatchReservationInput): void {
  if (
    !plainExactObject(input, ['sessionId', 'accountId', 'sessionVersion']) ||
    typeof input.sessionId !== 'string' ||
    !UUID_PATTERN.test(input.sessionId) ||
    typeof input.accountId !== 'string' ||
    !UUID_PATTERN.test(input.accountId) ||
    !positiveInteger(input.sessionVersion)
  ) {
    throw new TypeError('SESSION_NPC_MATCH_RESERVATION_INVALID');
  }
}

function validateNpcRecoveryOwnershipInput(
  input: SessionNpcMatchRecoveryOwnershipInput,
): void {
  if (
    !plainExactObject(input, ['sessionId', 'accountId', 'sessionVersion', 'matchId']) ||
    typeof input.sessionId !== 'string' ||
    !UUID_PATTERN.test(input.sessionId) ||
    typeof input.accountId !== 'string' ||
    !UUID_PATTERN.test(input.accountId) ||
    !positiveInteger(input.sessionVersion) ||
    typeof input.matchId !== 'string' ||
    !MATCH_ID_PATTERN.test(input.matchId)
  ) {
    throw new TypeError('SESSION_NPC_MATCH_RECOVERY_OWNERSHIP_INVALID');
  }
}

function validNpcMatchIdentityFields(value: Record<string, unknown>): boolean {
  return (
    typeof value.accountId === 'string' &&
    UUID_PATTERN.test(value.accountId) &&
    positiveInteger(value.sessionVersion) &&
    typeof value.matchId === 'string' &&
    MATCH_ID_PATTERN.test(value.matchId) &&
    Number.isSafeInteger(value.seed) &&
    Number(value.seed) >= 0 &&
    Number(value.seed) <= 0xffff_ffff
  );
}

function validActiveNpcMatchReservation(
  value: unknown,
): value is ActiveNpcMatchReservation {
  return (
    plainExactObject(value, [
      'accountId',
      'sessionVersion',
      'matchId',
      'seed',
      'createdAtEpochMs',
    ]) &&
    validNpcMatchIdentityFields(value) &&
    positiveInteger(value.createdAtEpochMs)
  );
}

function validRecentNpcMatchRecoveryOwnership(
  value: unknown,
): value is RecentNpcMatchRecoveryOwnership {
  return (
    plainExactObject(value, [
      'accountId',
      'sessionVersion',
      'matchId',
      'seed',
      'releasedAtEpochMs',
    ]) &&
    validNpcMatchIdentityFields(value) &&
    positiveInteger(value.releasedAtEpochMs)
  );
}

function sameNpcMatchPrincipal(
  stored: Pick<ActiveNpcMatchReservation, 'accountId' | 'sessionVersion'>,
  input: SessionNpcMatchReservationInput,
): boolean {
  return (
    stored.accountId === input.accountId &&
    stored.sessionVersion === input.sessionVersion
  );
}

function sameNpcMatchRelease(
  stored: Pick<
    RecentNpcMatchRecoveryOwnership,
    'accountId' | 'sessionVersion' | 'matchId' | 'seed'
  >,
  input: SessionNpcMatchReleaseInput,
): boolean {
  return (
    sameNpcMatchPrincipal(stored, input) &&
    stored.matchId === input.matchId &&
    stored.seed === input.seed
  );
}

function npcMatchRecoveryExpired(
  recovery: RecentNpcMatchRecoveryOwnership,
  nowEpochMs: number,
): boolean {
  return recovery.releasedAtEpochMs <= nowEpochMs - NPC_MATCH_RECOVERY_RETENTION_MS;
}

function randomUint32(): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0]!;
}

function validateNpcReleaseInput(input: SessionNpcMatchReleaseInput): void {
  if (
    !plainExactObject(input, [
      'sessionId',
      'accountId',
      'sessionVersion',
      'matchId',
      'seed',
    ]) ||
    typeof input.sessionId !== 'string' ||
    !UUID_PATTERN.test(input.sessionId) ||
    typeof input.accountId !== 'string' ||
    !UUID_PATTERN.test(input.accountId) ||
    !positiveInteger(input.sessionVersion) ||
    typeof input.matchId !== 'string' ||
    !MATCH_ID_PATTERN.test(input.matchId) ||
    !Number.isSafeInteger(input.seed) ||
    input.seed < 0 ||
    input.seed > 0xffff_ffff
  ) {
    throw new TypeError('SESSION_NPC_MATCH_RELEASE_INVALID');
  }
}

function validateLogoutIntent(input: SessionLogoutIntent): void {
  if (
    !UUID_PATTERN.test(input.sessionId) ||
    !UUID_PATTERN.test(input.accountId) ||
    !positiveInteger(input.sessionVersion) ||
    !DIGEST_PATTERN.test(input.sessionDigestHex) ||
    !positiveInteger(input.sessionDigestKeyVersion) ||
    input.sessionDigestKeyVersion > 32_767
  ) {
    throw new TypeError('SESSION_LOGOUT_INTENT_INVALID');
  }
}

/**
 * matchId単位floorを上限件数に収める。溢れたら最も古いupdatedAtEpochMsから間引く。
 * 間引かれたmatchの遅延registerは再び通り得るが、そのmatchのreference cleanupは
 * 別途MatchDO側のterminal outboxが担うため、floorは再送検知の補助であり正本ではない。
 */
function boundedCancelledFloors(
  floors: CancelledRegistrationFloorsByMatch,
  matchId: string,
  next: CancelledRegistrationFloor,
): CancelledRegistrationFloorsByMatch {
  const merged: CancelledRegistrationFloorsByMatch = { ...floors, [matchId]: next };
  const entries = Object.entries(merged);
  if (entries.length <= MAX_TRACKED_CANCELLED_MATCH_FLOORS) return merged;
  entries.sort((a, b) => a[1].updatedAtEpochMs - b[1].updatedAtEpochMs);
  const dropCount = entries.length - MAX_TRACKED_CANCELLED_MATCH_FLOORS;
  const dropped = new Set(entries.slice(0, dropCount).map(([id]) => id));
  const bounded: CancelledRegistrationFloorsByMatch = {};
  for (const [id, floor] of entries) {
    if (!dropped.has(id)) bounded[id] = floor;
  }
  return bounded;
}

function retryDelayMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(16, attempt - 1));
  return Math.min(INVALIDATION_RETRY_MAX_MS, INVALIDATION_RETRY_BASE_MS * 2 ** exponent);
}

function retryErrorCode(error: unknown): string {
  if (error instanceof SessionStoreError) return error.code;
  return error instanceof Error && error.message === 'SESSION_LOGOUT_RECOVERY_REJECTED'
    ? error.message
    : 'SESSION_COORDINATOR_RETRY';
}

function blockedVersion(
  floor: InvalidationFloor | undefined,
  work: LogoutWork | undefined,
): number | null {
  let version = floor?.invalidatedVersion ?? null;
  const workVersion =
    work?.phase === 'revoke_pending'
      ? work.sessionVersion + 1
      : work?.invalidatedVersion ?? null;
  if (workVersion !== null && (version === null || workVersion > version)) {
    version = workVersion;
  }
  return version;
}

function sameIntent(work: RevokePendingWork, input: SessionLogoutIntent): boolean {
  return (
    work.accountId === input.accountId &&
    work.sessionVersion === input.sessionVersion &&
    work.sessionDigestHex === input.sessionDigestHex &&
    work.sessionDigestKeyVersion === input.sessionDigestKeyVersion
  );
}

function matchIdsBelowVersion(
  references: readonly MatchReference[],
  invalidatedVersion: number,
): string[] {
  return [...new Set(
    references
      .filter((reference) => reference.sessionVersion < invalidatedVersion)
      .map((reference) => reference.matchId),
  )];
}

async function ensureEarlierAlarm(
  transaction: DurableObjectTransaction,
  dueAtEpochMs: number,
): Promise<void> {
  const current = await transaction.getAlarm();
  if (current === null || dueAtEpochMs < current) {
    await transaction.setAlarm(dueAtEpochMs);
  }
}

/**
 * session単位のlogout intent・match参照・失効fan-out正本。
 * intentとalarmを同じstorage transactionへ先に置き、Worker応答喪失後もDB失効から再開する。
 */
export class SessionCoordinatorDO extends DurableObject<Env> {
  async registerMatch(
    input: SessionMatchReferenceInput,
  ): Promise<SessionMatchRegistrationResult> {
    validateReferenceInput(input);
    validateIdentity(this.ctx.id.name, input.sessionId);

    return this.ctx.storage.transaction(async (transaction) => {
      const [floor, work, storedReferences, cancelledFloors] = await Promise.all([
        transaction.get<InvalidationFloor>(INVALIDATION_FLOOR_KEY),
        transaction.get<LogoutWork>(LOGOUT_WORK_KEY),
        transaction.get<MatchReference[]>(MATCH_REFERENCES_KEY),
        transaction.get<CancelledRegistrationFloorsByMatch>(CANCELLED_REGISTRATION_FLOOR_KEY),
      ]);
      const invalidatedVersion = blockedVersion(floor, work);
      if (invalidatedVersion !== null && invalidatedVersion > input.sessionVersion) {
        return { state: 'invalidated', invalidatedVersion } as const;
      }
      const references = storedReferences ?? [];
      const alreadyRegistered = references.some(
        (reference) =>
          reference.matchId === input.matchId &&
          reference.sessionVersion === input.sessionVersion &&
          reference.registrationId === input.registrationId &&
          reference.registrationEpochMs === input.registrationEpochMs,
      );
      if (alreadyRegistered) return { state: 'registered' } as const;
      const cancelledFloor = cancelledFloors?.[input.matchId];
      if (
        cancelledFloor &&
        input.registrationEpochMs <= cancelledFloor.registrationEpochMs
      ) {
        return {
          state: 'cancelled',
          cancelledThroughEpochMs: cancelledFloor.registrationEpochMs,
        } as const;
      }

      const matchIds = new Set(references.map((reference) => reference.matchId));
      if (!matchIds.has(input.matchId) && matchIds.size >= MAX_SESSION_MATCH_REFERENCES) {
        return { state: 'capacity_exceeded' } as const;
      }
      const sameMatchCount = references.filter(
        (reference) => reference.matchId === input.matchId,
      ).length;
      if (sameMatchCount >= MAX_SESSION_MATCH_REGISTRATIONS_PER_MATCH) {
        return { state: 'capacity_exceeded' } as const;
      }
      const next = references.concat({
        matchId: input.matchId,
        sessionVersion: input.sessionVersion,
        registrationId: input.registrationId,
        registrationEpochMs: input.registrationEpochMs,
      });
      await transaction.put(MATCH_REFERENCES_KEY, next);
      return { state: 'registered' } as const;
    });
  }

  /** exact assignment再送用のread-only barrier。参照を復活させない。 */
  async checkMatch(input: SessionMatchReferenceInput): Promise<SessionMatchReferenceStatus> {
    validateReferenceInput(input);
    validateIdentity(this.ctx.id.name, input.sessionId);
    return this.ctx.storage.transaction(async (transaction) => {
      const [floor, work, references] = await Promise.all([
        transaction.get<InvalidationFloor>(INVALIDATION_FLOOR_KEY),
        transaction.get<LogoutWork>(LOGOUT_WORK_KEY),
        transaction.get<MatchReference[]>(MATCH_REFERENCES_KEY),
      ]);
      const invalidatedVersion = blockedVersion(floor, work);
      if (invalidatedVersion !== null && invalidatedVersion > input.sessionVersion) {
        return { state: 'invalidated', invalidatedVersion } as const;
      }
      const registered = (references ?? []).some(
        (reference) =>
          reference.matchId === input.matchId &&
          reference.sessionVersion === input.sessionVersion &&
          reference.registrationId === input.registrationId &&
          reference.registrationEpochMs === input.registrationEpochMs,
      );
      return registered ? { state: 'registered' } as const : { state: 'missing' } as const;
    });
  }

  /** match接続前のread-only membership barrier。参照の生成・復活は行わない。 */
  async checkMatchMembership(
    input: SessionMatchMembershipInput,
  ): Promise<SessionMatchMembershipStatus> {
    validateMembershipInput(input);
    validateIdentity(this.ctx.id.name, input.sessionId);
    return this.ctx.storage.transaction(async (transaction) => {
      const [floor, work] = await Promise.all([
        transaction.get<InvalidationFloor>(INVALIDATION_FLOOR_KEY),
        transaction.get<LogoutWork>(LOGOUT_WORK_KEY),
      ]);
      const invalidatedVersion = blockedVersion(floor, work);
      if (invalidatedVersion !== null && invalidatedVersion > input.sessionVersion) {
        return { state: 'invalidated', invalidatedVersion } as const;
      }

      const references = await transaction.get<MatchReference[]>(MATCH_REFERENCES_KEY);
      const registered = (references ?? []).some(
        (reference) =>
          reference.matchId === input.matchId &&
          reference.sessionVersion === input.sessionVersion,
      );
      return registered ? { state: 'registered' } as const : { state: 'missing' } as const;
    });
  }

  /** Workerだけが呼ぶ、sessionごと1件のserver-owned NPC match予約。 */
  async reserveNpcMatch(
    input: SessionNpcMatchReservationInput,
  ): Promise<SessionNpcMatchReservationResult> {
    validateNpcReservationInput(input);
    validateIdentity(this.ctx.id.name, input.sessionId);
    return this.ctx.storage.transaction(async (transaction) => {
      const [floor, work, reservationValue, recoveryValue] = await Promise.all([
        transaction.get<InvalidationFloor>(INVALIDATION_FLOOR_KEY),
        transaction.get<LogoutWork>(LOGOUT_WORK_KEY),
        transaction.get<unknown>(ACTIVE_NPC_MATCH_RESERVATION_KEY),
        transaction.get<unknown>(RECENT_NPC_MATCH_RECOVERY_KEY),
      ]);
      const invalidatedVersion = blockedVersion(floor, work);
      if (invalidatedVersion !== null && invalidatedVersion > input.sessionVersion) {
        if (
          validActiveNpcMatchReservation(reservationValue) &&
          reservationValue.sessionVersion < invalidatedVersion
        ) {
          await transaction.delete(ACTIVE_NPC_MATCH_RESERVATION_KEY);
        }
        if (
          validRecentNpcMatchRecoveryOwnership(recoveryValue) &&
          recoveryValue.sessionVersion < invalidatedVersion
        ) {
          await transaction.delete(RECENT_NPC_MATCH_RECOVERY_KEY);
        }
        return { state: 'invalidated', invalidatedVersion } as const;
      }
      if (reservationValue !== undefined) {
        if (!validActiveNpcMatchReservation(reservationValue)) {
          return { state: 'conflict' } as const;
        }
        return sameNpcMatchPrincipal(reservationValue, input)
          ? {
              state: 'reserved',
              matchId: reservationValue.matchId,
              seed: reservationValue.seed,
              created: false,
            } as const
          : { state: 'conflict' } as const;
      }

      if (recoveryValue !== undefined) {
        if (!validRecentNpcMatchRecoveryOwnership(recoveryValue)) {
          return { state: 'conflict' } as const;
        }
        if (
          npcMatchRecoveryExpired(recoveryValue, Date.now()) ||
          sameNpcMatchPrincipal(recoveryValue, input)
        ) {
          await transaction.delete(RECENT_NPC_MATCH_RECOVERY_KEY);
        } else {
          return { state: 'conflict' } as const;
        }
      }

      const next: ActiveNpcMatchReservation = {
        accountId: input.accountId,
        sessionVersion: input.sessionVersion,
        matchId: `npc-${crypto.randomUUID()}`,
        seed: randomUint32(),
        createdAtEpochMs: Date.now(),
      };
      await transaction.put(ACTIVE_NPC_MATCH_RESERVATION_KEY, next);
      return {
        state: 'reserved',
        matchId: next.matchId,
        seed: next.seed,
        created: true,
      } as const;
    });
  }

  /** 起動時のread-only discovery。期限切れrecentのlazy delete以外はstorageを変えない。 */
  async readNpcMatch(
    input: SessionNpcMatchReservationInput,
  ): Promise<SessionNpcMatchReadResult> {
    validateNpcReservationInput(input);
    validateIdentity(this.ctx.id.name, input.sessionId);
    return this.ctx.storage.transaction(async (transaction) => {
      const [floor, work, reservationValue, recoveryValue] = await Promise.all([
        transaction.get<InvalidationFloor>(INVALIDATION_FLOOR_KEY),
        transaction.get<LogoutWork>(LOGOUT_WORK_KEY),
        transaction.get<unknown>(ACTIVE_NPC_MATCH_RESERVATION_KEY),
        transaction.get<unknown>(RECENT_NPC_MATCH_RECOVERY_KEY),
      ]);
      const invalidatedVersion = blockedVersion(floor, work);
      if (invalidatedVersion !== null && invalidatedVersion > input.sessionVersion) {
        return { state: 'invalidated', invalidatedVersion } as const;
      }

      if (reservationValue !== undefined) {
        if (!validActiveNpcMatchReservation(reservationValue)) {
          return { state: 'conflict' } as const;
        }
        return sameNpcMatchPrincipal(reservationValue, input)
          ? { state: 'located', matchId: reservationValue.matchId } as const
          : { state: 'conflict' } as const;
      }
      if (recoveryValue === undefined) return { state: 'none' } as const;
      if (!validRecentNpcMatchRecoveryOwnership(recoveryValue)) {
        return { state: 'conflict' } as const;
      }
      if (npcMatchRecoveryExpired(recoveryValue, Date.now())) {
        await transaction.delete(RECENT_NPC_MATCH_RECOVERY_KEY);
        return { state: 'none' } as const;
      }
      return sameNpcMatchPrincipal(recoveryValue, input)
        ? { state: 'located', matchId: recoveryValue.matchId } as const
        : { state: 'conflict' } as const;
    });
  }

  /** active/recent ownershipをclient指定MatchDO取得前にpositive確認する。 */
  async checkNpcMatchRecoveryOwnership(
    input: SessionNpcMatchRecoveryOwnershipInput,
  ): Promise<SessionNpcMatchRecoveryOwnershipStatus> {
    validateNpcRecoveryOwnershipInput(input);
    validateIdentity(this.ctx.id.name, input.sessionId);
    return this.ctx.storage.transaction(async (transaction) => {
      const [floor, work, reservationValue, recoveryValue] = await Promise.all([
        transaction.get<InvalidationFloor>(INVALIDATION_FLOOR_KEY),
        transaction.get<LogoutWork>(LOGOUT_WORK_KEY),
        transaction.get<unknown>(ACTIVE_NPC_MATCH_RESERVATION_KEY),
        transaction.get<unknown>(RECENT_NPC_MATCH_RECOVERY_KEY),
      ]);
      const invalidatedVersion = blockedVersion(floor, work);
      if (invalidatedVersion !== null && invalidatedVersion > input.sessionVersion) {
        return { state: 'invalidated', invalidatedVersion } as const;
      }

      if (reservationValue !== undefined) {
        if (!validActiveNpcMatchReservation(reservationValue)) {
          return { state: 'conflict' } as const;
        }
        if (!sameNpcMatchPrincipal(reservationValue, input)) {
          return { state: 'conflict' } as const;
        }
        return reservationValue.matchId === input.matchId
          ? { state: 'authorized' } as const
          : { state: 'missing' } as const;
      }
      if (recoveryValue === undefined) return { state: 'missing' } as const;
      if (!validRecentNpcMatchRecoveryOwnership(recoveryValue)) {
        return { state: 'conflict' } as const;
      }
      if (npcMatchRecoveryExpired(recoveryValue, Date.now())) {
        await transaction.delete(RECENT_NPC_MATCH_RECOVERY_KEY);
        return { state: 'missing' } as const;
      }
      if (!sameNpcMatchPrincipal(recoveryValue, input)) {
        return { state: 'conflict' } as const;
      }
      return recoveryValue.matchId === input.matchId
        ? { state: 'authorized' } as const
        : { state: 'missing' } as const;
    });
  }

  /** terminal永続化後にだけ呼ぶ、exact予約の明示解放。 */
  async releaseNpcMatch(
    input: SessionNpcMatchReleaseInput,
  ): Promise<SessionNpcMatchReleaseResult> {
    validateNpcReleaseInput(input);
    validateIdentity(this.ctx.id.name, input.sessionId);
    return this.ctx.storage.transaction(async (transaction) => {
      const [reservationValue, recoveryValue, references] = await Promise.all([
        transaction.get<unknown>(ACTIVE_NPC_MATCH_RESERVATION_KEY),
        transaction.get<unknown>(RECENT_NPC_MATCH_RECOVERY_KEY),
        transaction.get<MatchReference[]>(MATCH_REFERENCES_KEY),
      ]);
      if (reservationValue === undefined) {
        if (recoveryValue === undefined) return { state: 'missing' } as const;
        if (!validRecentNpcMatchRecoveryOwnership(recoveryValue)) {
          return { state: 'conflict' } as const;
        }
        return sameNpcMatchRelease(recoveryValue, input)
          ? { state: 'released' } as const
          : { state: 'conflict' } as const;
      }
      if (
        !validActiveNpcMatchReservation(reservationValue) ||
        !sameNpcMatchRelease(reservationValue, input) ||
        recoveryValue !== undefined
      ) {
        return { state: 'conflict' } as const;
      }
      if ((references ?? []).some(
        (reference) =>
          reference.matchId === input.matchId &&
          reference.sessionVersion === input.sessionVersion,
      )) {
        return { state: 'references_remain' } as const;
      }
      await transaction.put<RecentNpcMatchRecoveryOwnership>(
        RECENT_NPC_MATCH_RECOVERY_KEY,
        {
          accountId: input.accountId,
          sessionVersion: input.sessionVersion,
          matchId: input.matchId,
          seed: input.seed,
          releasedAtEpochMs: Date.now(),
        },
      );
      await transaction.delete(ACTIVE_NPC_MATCH_RESERVATION_KEY);
      return { state: 'released' } as const;
    });
  }

  async unregisterMatch(
    input: SessionMatchReferenceInput,
  ): Promise<{ state: 'acknowledged' }> {
    validateReferenceInput(input);
    validateIdentity(this.ctx.id.name, input.sessionId);
    await this.ctx.storage.transaction(async (transaction) => {
      const [references, cancelledFloors] = await Promise.all([
        transaction.get<MatchReference[]>(MATCH_REFERENCES_KEY),
        transaction.get<CancelledRegistrationFloorsByMatch>(CANCELLED_REGISTRATION_FLOOR_KEY),
      ]);
      const currentReferences = references ?? [];
      const next = currentReferences.filter(
        (reference) =>
          reference.matchId !== input.matchId ||
          reference.sessionVersion !== input.sessionVersion ||
          reference.registrationId !== input.registrationId ||
          reference.registrationEpochMs !== input.registrationEpochMs,
      );
      const currentFloors = cancelledFloors ?? {};
      const matchFloor = currentFloors[input.matchId];
      if (!matchFloor || input.registrationEpochMs > matchFloor.registrationEpochMs) {
        await transaction.put<CancelledRegistrationFloorsByMatch>(
          CANCELLED_REGISTRATION_FLOOR_KEY,
          boundedCancelledFloors(currentFloors, input.matchId, {
            registrationEpochMs: input.registrationEpochMs,
            updatedAtEpochMs: Date.now(),
          }),
        );
      }
      if (next.length !== currentReferences.length) {
        await transaction.put(MATCH_REFERENCES_KEY, next);
      }
    });
    return { state: 'acknowledged' };
  }

  async prepareLogout(
    input: SessionLogoutIntent,
  ): Promise<SessionLogoutPreparationResult> {
    validateLogoutIntent(input);
    validateIdentity(this.ctx.id.name, input.sessionId);
    const now = Date.now();
    return this.ctx.storage.transaction(async (transaction) => {
      const [floor, work] = await Promise.all([
        transaction.get<InvalidationFloor>(INVALIDATION_FLOOR_KEY),
        transaction.get<LogoutWork>(LOGOUT_WORK_KEY),
      ]);
      if (!work && floor && floor.invalidatedVersion > input.sessionVersion) {
        return {
          state: 'already_completed',
          invalidatedVersion: floor.invalidatedVersion,
        } as const;
      }
      if (work?.phase === 'fanout_pending') {
        if (
          work.source === 'logout' &&
          work.accountId === input.accountId &&
          work.sessionVersion === input.sessionVersion
        ) {
          await ensureEarlierAlarm(transaction, now + INVALIDATION_RETRY_BASE_MS);
          return {
            state: 'fanout_pending',
            invalidatedVersion: work.invalidatedVersion,
          } as const;
        }
        return { state: 'conflict' } as const;
      }
      if (work?.phase === 'revoke_pending') {
        if (!sameIntent(work, input)) return { state: 'conflict' } as const;
        await ensureEarlierAlarm(transaction, now + LOGOUT_RECOVERY_DELAY_MS);
        return { state: 'prepared' } as const;
      }

      const next: RevokePendingWork = {
        phase: 'revoke_pending',
        accountId: input.accountId,
        sessionVersion: input.sessionVersion,
        sessionDigestHex: input.sessionDigestHex,
        sessionDigestKeyVersion: input.sessionDigestKeyVersion,
        retryAttempt: 0,
        createdAtEpochMs: now,
      };
      await transaction.put(LOGOUT_WORK_KEY, next);
      await ensureEarlierAlarm(transaction, now + LOGOUT_RECOVERY_DELAY_MS);
      return { state: 'prepared' } as const;
    });
  }

  async confirmLogout(
    input: SessionLogoutConfirmation,
  ): Promise<SessionInvalidationResult> {
    validateLogoutIntent(input);
    if (
      !positiveInteger(input.invalidatedVersion) ||
      input.invalidatedVersion <= input.sessionVersion
    ) {
      throw new TypeError('SESSION_LOGOUT_CONFIRMATION_INVALID');
    }
    validateIdentity(this.ctx.id.name, input.sessionId);
    const transition = await this.promoteConfirmedLogout(input);
    if (transition === 'completed') {
      return {
        state: 'acknowledged',
        invalidatedVersion: input.invalidatedVersion,
        matchedObjects: 0,
      };
    }
    if (transition === 'conflict') {
      throw new TypeError('SESSION_LOGOUT_CONFIRMATION_INVALID');
    }
    return this.fanOutCurrentInvalidation();
  }

  /** DB失効ACKを既に得たinternal caller向け。通常logoutはprepare→DB→confirmを使う。 */
  async invalidateSession(input: {
    sessionId: string;
    invalidatedVersion: number;
  }): Promise<SessionInvalidationResult> {
    if (!UUID_PATTERN.test(input.sessionId) || !positiveInteger(input.invalidatedVersion)) {
      throw new TypeError('SESSION_INVALIDATION_INVALID');
    }
    validateIdentity(this.ctx.id.name, input.sessionId);
    const now = Date.now();
    const transition = await this.ctx.storage.transaction(async (transaction) => {
      const [floor, work, references, reservation, recovery] = await Promise.all([
        transaction.get<InvalidationFloor>(INVALIDATION_FLOOR_KEY),
        transaction.get<LogoutWork>(LOGOUT_WORK_KEY),
        transaction.get<MatchReference[]>(MATCH_REFERENCES_KEY),
        transaction.get<ActiveNpcMatchReservation>(ACTIVE_NPC_MATCH_RESERVATION_KEY),
        transaction.get<RecentNpcMatchRecoveryOwnership>(RECENT_NPC_MATCH_RECOVERY_KEY),
      ]);
      if (
        work?.phase === 'revoke_pending' &&
        input.invalidatedVersion <= work.sessionVersion
      ) {
        await ensureEarlierAlarm(transaction, now + LOGOUT_RECOVERY_DELAY_MS);
        const invalidatedVersion = work.sessionVersion + 1;
        return {
          state: 'preserved' as const,
          invalidatedVersion,
          pendingObjects: matchIdsBelowVersion(
            references ?? [],
            invalidatedVersion,
          ).length,
        };
      }
      const version = Math.max(floor?.invalidatedVersion ?? 1, input.invalidatedVersion);
      await transaction.put<InvalidationFloor>(INVALIDATION_FLOOR_KEY, {
        invalidatedVersion: version,
        updatedAtEpochMs: now,
      });
      await transaction.put<FanoutPendingWork>(LOGOUT_WORK_KEY, {
        phase: 'fanout_pending',
        source: 'direct',
        invalidatedVersion: version,
        retryAttempt: 0,
        createdAtEpochMs: now,
      });
      if (reservation && reservation.sessionVersion < version) {
        await transaction.delete(ACTIVE_NPC_MATCH_RESERVATION_KEY);
      }
      if (recovery && recovery.sessionVersion < version) {
        await transaction.delete(RECENT_NPC_MATCH_RECOVERY_KEY);
      }
      await ensureEarlierAlarm(transaction, now + INVALIDATION_RETRY_BASE_MS);
      return { state: 'promoted' as const };
    });
    if (transition.state === 'preserved') {
      return {
        state: 'pending',
        invalidatedVersion: transition.invalidatedVersion,
        pendingObjects: transition.pendingObjects,
      };
    }
    return this.fanOutCurrentInvalidation();
  }

  async alarm(): Promise<void> {
    try {
      await this.processLogoutWork();
    } catch (error) {
      await this.scheduleRetry(retryErrorCode(error));
    }
  }

  private async promoteConfirmedLogout(
    input: SessionLogoutConfirmation,
  ): Promise<'promoted' | 'completed' | 'conflict'> {
    const now = Date.now();
    return this.ctx.storage.transaction(async (transaction) => {
      const [work, floor, reservation, recovery] = await Promise.all([
        transaction.get<LogoutWork>(LOGOUT_WORK_KEY),
        transaction.get<InvalidationFloor>(INVALIDATION_FLOOR_KEY),
        transaction.get<ActiveNpcMatchReservation>(ACTIVE_NPC_MATCH_RESERVATION_KEY),
        transaction.get<RecentNpcMatchRecoveryOwnership>(RECENT_NPC_MATCH_RECOVERY_KEY),
      ]);
      if (!work) {
        return floor && floor.invalidatedVersion >= input.invalidatedVersion
          ? 'completed'
          : 'conflict';
      }
      if (work.phase === 'revoke_pending' && !sameIntent(work, input)) {
        return 'conflict';
      }
      if (
        work.phase === 'fanout_pending' &&
        (work.source !== 'logout' ||
          work.accountId !== input.accountId ||
          work.sessionVersion !== input.sessionVersion)
      ) {
        return 'conflict';
      }
      const invalidatedVersion = Math.max(
        floor?.invalidatedVersion ?? 1,
        work.phase === 'fanout_pending' ? work.invalidatedVersion : 1,
        input.invalidatedVersion,
      );
      await transaction.put<InvalidationFloor>(INVALIDATION_FLOOR_KEY, {
        invalidatedVersion,
        updatedAtEpochMs: now,
      });
      await transaction.put<FanoutPendingWork>(LOGOUT_WORK_KEY, {
        phase: 'fanout_pending',
        source: 'logout',
        accountId: input.accountId,
        sessionVersion: input.sessionVersion,
        invalidatedVersion,
        retryAttempt: 0,
        createdAtEpochMs: work.createdAtEpochMs,
      });
      if (reservation && reservation.sessionVersion < invalidatedVersion) {
        await transaction.delete(ACTIVE_NPC_MATCH_RESERVATION_KEY);
      }
      if (recovery && recovery.sessionVersion < invalidatedVersion) {
        await transaction.delete(RECENT_NPC_MATCH_RECOVERY_KEY);
      }
      await ensureEarlierAlarm(transaction, now + INVALIDATION_RETRY_BASE_MS);
      return 'promoted';
    });
  }

  private async processLogoutWork(): Promise<SessionInvalidationResult> {
    const work = await this.ctx.storage.get<LogoutWork>(LOGOUT_WORK_KEY);
    if (!work) {
      const floor = await this.ctx.storage.get<InvalidationFloor>(INVALIDATION_FLOOR_KEY);
      return {
        state: 'acknowledged',
        invalidatedVersion: floor?.invalidatedVersion ?? 1,
        matchedObjects: 0,
      };
    }
    if (work.phase === 'fanout_pending') return this.fanOutCurrentInvalidation();

    try {
      const config = createSessionRuntimeConfig(this.env);
      const store = new SupabaseSessionStore(config.storeCredential, { timeoutMs: 7_000 });
      const revoked = await store.revokeSession({
        sessionDigestHex: work.sessionDigestHex,
        sessionDigestKeyVersion: work.sessionDigestKeyVersion,
        reason: LOGOUT_REASON,
      });
      if (
        !revoked ||
        revoked.sessionId !== this.ctx.id.name ||
        revoked.accountId !== work.accountId ||
        revoked.sessionVersion <= work.sessionVersion
      ) {
        throw new Error('SESSION_LOGOUT_RECOVERY_REJECTED');
      }
      const confirmation: SessionLogoutConfirmation = {
        sessionId: this.ctx.id.name!,
        accountId: work.accountId,
        sessionVersion: work.sessionVersion,
        sessionDigestHex: work.sessionDigestHex,
        sessionDigestKeyVersion: work.sessionDigestKeyVersion,
        invalidatedVersion: revoked.sessionVersion,
      };
      const transition = await this.promoteConfirmedLogout(confirmation);
      if (transition === 'conflict') throw new Error('SESSION_LOGOUT_RECOVERY_REJECTED');
      return this.fanOutCurrentInvalidation();
    } catch (error) {
      return this.scheduleRetry(retryErrorCode(error));
    }
  }

  private async fanOutCurrentInvalidation(): Promise<SessionInvalidationResult> {
    const [work, references] = await Promise.all([
      this.ctx.storage.get<LogoutWork>(LOGOUT_WORK_KEY),
      this.ctx.storage.get<MatchReference[]>(MATCH_REFERENCES_KEY),
    ]);
    if (!work || work.phase !== 'fanout_pending') return this.processLogoutWork();

    const eligibleMatchIds = matchIdsBelowVersion(
      references ?? [],
      work.invalidatedVersion,
    );
    const namespace = (this.env as Env & { MATCH_DO?: MatchNamespace }).MATCH_DO;
    const acknowledgedMatchIds: string[] = [];
    if (namespace) {
      const outcomes = await Promise.all(
        eligibleMatchIds.map(async (matchId) => {
          try {
            const stub = namespace.get(namespace.idFromName(matchId));
            const result = await stub.invalidateSession({
              sessionId: this.ctx.id.name!,
              invalidatedVersion: work.invalidatedVersion,
            });
            return result.state === 'acknowledged' ? matchId : null;
          } catch {
            return null;
          }
        }),
      );
      acknowledgedMatchIds.push(
        ...outcomes.filter((value): value is string => value !== null),
      );
    }

    const now = Date.now();
    return this.ctx.storage.transaction(async (transaction) => {
      const [currentWork, currentReferences, floor] = await Promise.all([
        transaction.get<LogoutWork>(LOGOUT_WORK_KEY),
        transaction.get<MatchReference[]>(MATCH_REFERENCES_KEY),
        transaction.get<InvalidationFloor>(INVALIDATION_FLOOR_KEY),
      ]);
      if (!currentWork || currentWork.phase !== 'fanout_pending') {
        return {
          state: 'acknowledged',
          invalidatedVersion: floor?.invalidatedVersion ?? work.invalidatedVersion,
          matchedObjects: acknowledgedMatchIds.length,
        } as const;
      }
      if (currentWork.invalidatedVersion !== work.invalidatedVersion) {
        const pendingObjects = matchIdsBelowVersion(
          currentReferences ?? [],
          currentWork.invalidatedVersion,
        ).length;
        await ensureEarlierAlarm(transaction, now + INVALIDATION_RETRY_BASE_MS);
        return {
          state: 'pending',
          invalidatedVersion: currentWork.invalidatedVersion,
          pendingObjects,
        } as const;
      }
      const acknowledged = new Set(acknowledgedMatchIds);
      const remaining = (currentReferences ?? []).filter(
        (reference) =>
          !acknowledged.has(reference.matchId) ||
          reference.sessionVersion >= currentWork.invalidatedVersion,
      );
      await transaction.put(MATCH_REFERENCES_KEY, remaining);
      const pending = matchIdsBelowVersion(
        remaining,
        currentWork.invalidatedVersion,
      );
      if (pending.length === 0) {
        await transaction.put<InvalidationFloor>(INVALIDATION_FLOOR_KEY, {
          invalidatedVersion: Math.max(
            floor?.invalidatedVersion ?? 1,
            currentWork.invalidatedVersion,
          ),
          updatedAtEpochMs: now,
        });
        await transaction.delete(LOGOUT_WORK_KEY);
        await transaction.deleteAlarm();
        return {
          state: 'acknowledged',
          invalidatedVersion: currentWork.invalidatedVersion,
          matchedObjects: acknowledgedMatchIds.length,
        } as const;
      }

      const retryAttempt = currentWork.retryAttempt + 1;
      await transaction.put<FanoutPendingWork>(LOGOUT_WORK_KEY, {
        ...currentWork,
        retryAttempt,
      });
      await transaction.setAlarm(now + retryDelayMs(retryAttempt));
      return {
        state: 'pending',
        invalidatedVersion: currentWork.invalidatedVersion,
        pendingObjects: pending.length,
      } as const;
    });
  }

  private async scheduleRetry(
    lastErrorCode = 'SESSION_COORDINATOR_RETRY',
  ): Promise<SessionInvalidationResult> {
    const now = Date.now();
    return this.ctx.storage.transaction(async (transaction) => {
      const [work, references, floor] = await Promise.all([
        transaction.get<LogoutWork>(LOGOUT_WORK_KEY),
        transaction.get<MatchReference[]>(MATCH_REFERENCES_KEY),
        transaction.get<InvalidationFloor>(INVALIDATION_FLOOR_KEY),
      ]);
      if (!work) {
        await transaction.deleteAlarm();
        return {
          state: 'acknowledged',
          invalidatedVersion: floor?.invalidatedVersion ?? 1,
          matchedObjects: 0,
        } as const;
      }
      const retryAttempt = work.retryAttempt + 1;
      await transaction.put(LOGOUT_WORK_KEY, {
        ...work,
        retryAttempt,
        lastErrorCode,
      });
      await transaction.setAlarm(now + retryDelayMs(retryAttempt));
      const invalidatedVersion =
        work.phase === 'fanout_pending'
          ? work.invalidatedVersion
          : work.sessionVersion + 1;
      const pendingObjects = matchIdsBelowVersion(
        references ?? [],
        invalidatedVersion,
      ).length;
      return { state: 'pending', invalidatedVersion, pendingObjects } as const;
    });
  }
}

export function sessionCoordinatorStub(
  bindings: SessionCoordinatorBindings,
  sessionId: string,
): SessionCoordinatorPort {
  if (!UUID_PATTERN.test(sessionId) || !bindings.SESSION_COORDINATOR_DO) {
    throw new Error('SESSION_COORDINATOR_UNAVAILABLE');
  }
  const namespace = bindings.SESSION_COORDINATOR_DO;
  return namespace.get(namespace.idFromName(sessionId));
}
