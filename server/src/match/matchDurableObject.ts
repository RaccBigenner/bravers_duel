import { DurableObject } from 'cloudflare:workers';
import { createSessionRuntimeConfig } from '../auth/sessionRuntimeConfig';
import type { TokenDigestCandidate } from '../auth/sessionCrypto';
import {
  EngineBattleAdapter,
  ENGINE_BATTLE_ADAPTER_VERSION,
  G1_NPC_POLICY_ID,
  HUMAN_PLAYER,
  NPC_PLAYER,
  g1NpcBattleInput,
  type AppliedBattleTransition,
  type AuthoritativeBattleSnapshot,
  type EngineBattleVersions,
  type NpcBattleResult,
} from '../battle/engineBattleAdapter';
import {
  sessionCoordinatorStub,
  type SessionCoordinatorPort,
  type SessionMatchRegistrationResult,
  type SessionMatchReferenceInput,
} from '../session/sessionCoordinatorDurableObject';
import {
  generateSeatToken,
  parseSeatAuthFrame,
  seatTokenDigestCandidates,
  seatTokenDigestHex,
} from './seatToken';

const MATCH_PATH = /^\/matches\/([A-Za-z0-9_-]{1,64})\/ws$/;
const MATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const PROBE_PREFIX = 'probe:';
const AUTHENTICATION_CLOSE_CODE = 1008;
const AUTHENTICATION_CLOSE_REASON = 'AUTH_FAILED';
const SESSION_CLOSE_REASON = 'SESSION_ENDED';
const SEAT_CLOSE_REASON = 'SEAT_REASSIGNED';
const REFERENCE_CLEANUP_DEADLINE_KIND = 'coordinator-cleanup';
const REFERENCE_CLEANUP_RETRY_BASE_MS = 1_000;
const REFERENCE_CLEANUP_RETRY_MAX_MS = 60_000;
const REFERENCE_CLEANUP_BATCH_SIZE = 1;
const TERMINAL_RELEASE_DEADLINE_KIND = 'coordinator-terminal-release';
const TERMINAL_RELEASE_PHASE_UNREGISTER = 'unregister_pending';
const TERMINAL_RELEASE_PHASE_RESERVATION = 'reservation_release_pending';
const NPC_MATCH_ID_PATTERN = /^npc-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MATCH_TERMINAL_CLOSE_CODE = 1000;
const MATCH_TERMINAL_CLOSE_REASON = 'MATCH_ENDED';

export const SEAT_TOKEN_TTL_MS = 30_000;
export const SEAT_AUTH_FRAME_TIMEOUT_MS = 5_000;
export const MAX_OUTSTANDING_SEAT_TOKENS = 4;

export const INTERNAL_ACCOUNT_ID_HEADER = 'X-Bravers-Internal-Account-Id';
export const INTERNAL_SESSION_ID_HEADER = 'X-Bravers-Internal-Session-Id';
export const INTERNAL_SESSION_VERSION_HEADER = 'X-Bravers-Internal-Session-Version';

export type MatchSeatId = 'player-1' | 'player-2';

export interface MatchSessionPrincipal {
  accountId: string;
  sessionId: string;
  sessionVersion: number;
}

export type NpcBattleLifecycleState =
  | 'provisioning'
  | 'active'
  | 'finished'
  | 'cancelled'
  | 'abandoned';

export type NpcBattleCancellationReason = 'server_cancelled' | 'start_failed';
export type NpcBattleAbandonReason = 'player_abandoned';

export type NpcBattleTerminalResult =
  | {
      kind: 'finished';
      winner: 0 | 1 | null;
      endReason: NpcBattleResult['endReason'];
      turns: number;
      finalStateHash: string;
      appliedActions: number;
    }
  | {
      kind: 'cancelled';
      winner: null;
      reason: NpcBattleCancellationReason;
      turns: number | null;
      finalStateHash: string | null;
      appliedActions: number | null;
    }
  | {
      kind: 'abandoned';
      winner: typeof NPC_PLAYER;
      reason: NpcBattleAbandonReason;
      turns: number;
      finalStateHash: string;
      appliedActions: number;
    };

export interface NpcBattleLifecycle {
  matchId: string;
  state: NpcBattleLifecycleState;
  principal: MatchSessionPrincipal;
  seatId: 'player-1';
  assignmentVersion: number | null;
  seed: number;
  versions: EngineBattleVersions;
  startedAtEpochMs: number;
  terminalAtEpochMs: number | null;
  terminalResult: NpcBattleTerminalResult | null;
}

export interface StartNpcBattleInput {
  principal: MatchSessionPrincipal;
  seed: number;
}

export type StartNpcBattleResult =
  | { state: 'ready'; created: boolean }
  | { state: 'conflict' }
  | { state: 'unavailable' };

export interface ApplyNpcBattleActionInput {
  principal: MatchSessionPrincipal;
  action: unknown;
}

export interface ApplyNpcBattleActionResult {
  state: 'applied';
  transition: AppliedBattleTransition;
  lifecycleState: 'active' | 'finished';
}

export type MatchBattleErrorCode =
  | 'MATCH_BATTLE_INPUT_INVALID'
  | 'MATCH_BATTLE_NOT_STARTED'
  | 'MATCH_BATTLE_ACCESS_DENIED'
  | 'MATCH_BATTLE_ALREADY_TERMINAL'
  | 'MATCH_BATTLE_STATE_INVALID'
  | 'MATCH_STATE_UNAVAILABLE';

export class MatchBattleError extends Error {
  constructor(public readonly code: MatchBattleErrorCode) {
    super(code);
    this.name = 'MatchBattleError';
  }
}

export type SeatAssignmentResult =
  | { state: 'assigned'; seatId: MatchSeatId; assignmentVersion: number }
  | { state: 'conflict' };

export type SeatTokenIssueResult =
  | {
      state: 'issued';
      seatToken: string;
      expiresAtEpochMs: number;
    }
  | { state: 'not_assigned' }
  | { state: 'rate_limited' };

export type SeatTokenConsumeResult =
  | {
      state: 'consumed';
      seatId: MatchSeatId;
      assignmentVersion: number;
    }
  | { state: 'invalid' }
  | { state: 'ambiguous' };

interface DiagnosticAttachment {
  mode: 'diagnostic';
  matchId: 'local-smoke';
}

interface PendingAttachment extends MatchSessionPrincipal {
  mode: 'pending';
  matchId: string;
  connectionId: string;
  authDeadlineEpochMs: number;
}

interface VerifyingAttachment extends MatchSessionPrincipal {
  mode: 'verifying';
  matchId: string;
  connectionId: string;
  authDeadlineEpochMs: number;
}

interface AuthenticatedAttachment extends MatchSessionPrincipal {
  mode: 'authenticated';
  matchId: string;
  connectionId: string;
  seatId: MatchSeatId;
  assignmentVersion: number;
}

type ConnectionAttachment =
  | DiagnosticAttachment
  | PendingAttachment
  | VerifyingAttachment
  | AuthenticatedAttachment;

interface AssignmentRow {
  [key: string]: string | number | null;
  seat_id: string;
  account_id: string;
  session_id: string;
  session_version: number;
  assignment_version: number;
}

interface AssignmentReferenceRow extends AssignmentRow {
  coordinator_registration_id: string | null;
  coordinator_registration_epoch_ms: number | null;
}

interface TokenMatchRow {
  [key: string]: string | number;
  token_digest: string;
  digest_key_version: number;
  seat_id: string;
  assignment_version: number;
}

interface ReferenceCleanupRow {
  [key: string]: string | number;
  registration_id: string;
  registration_epoch_ms: number;
  seat_id: string;
  account_id: string;
  session_id: string;
  session_version: number;
  match_id: string;
  work_kind: string;
  retry_attempt: number;
}

interface BattleLifecycleRow {
  [key: string]: string | number | null;
  match_id: string;
  lifecycle_state: string;
  account_id: string;
  session_id: string;
  session_version: number;
  seat_id: string;
  assignment_version: number | null;
  seed: number;
  adapter_version: number;
  engine_version: string;
  content_version: string;
  format_version_id: string;
  npc_policy_id: string;
  started_at_ms: number;
  terminal_at_ms: number | null;
  terminal_reason: string | null;
  winner: number | null;
  engine_end_reason: string | null;
  turns: number | null;
  final_state_hash: string | null;
  applied_actions: number | null;
}

interface TerminalReleaseRow {
  [key: string]: string | number;
  registration_id: string;
  registration_epoch_ms: number;
  seat_id: string;
  account_id: string;
  session_id: string;
  session_version: number;
  match_id: string;
  seed: number;
  release_phase: string;
  retry_attempt: number;
}

interface NpcReservationReleasePort extends SessionCoordinatorPort {
  releaseNpcMatch(input: {
    sessionId: string;
    accountId: string;
    sessionVersion: number;
    matchId: string;
    seed: number;
  }): Promise<{
    state: 'released' | 'missing' | 'references_remain' | 'conflict';
  }>;
}

interface MatchReferenceWork extends SessionMatchReferenceInput {
  seatId: MatchSeatId;
  accountId: string;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(body), { ...init, headers });
}

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isPrincipal(value: MatchSessionPrincipal): boolean {
  return (
    UUID_PATTERN.test(value.accountId) &&
    UUID_PATTERN.test(value.sessionId) &&
    positiveInteger(value.sessionVersion)
  );
}

function isExactPrincipal(value: unknown): value is MatchSessionPrincipal {
  return (
    plainObject(value) &&
    hasExactKeys(value, ['accountId', 'sessionId', 'sessionVersion']) &&
    typeof value.accountId === 'string' &&
    typeof value.sessionId === 'string' &&
    isPrincipal(value as unknown as MatchSessionPrincipal)
  );
}

function validBattleSeed(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 0xffff_ffff;
}

function validateStartNpcBattleInput(value: unknown): asserts value is StartNpcBattleInput {
  if (
    !plainObject(value) ||
    !hasExactKeys(value, ['principal', 'seed']) ||
    !isExactPrincipal(value.principal) ||
    !validBattleSeed(value.seed)
  ) {
    throw new MatchBattleError('MATCH_BATTLE_INPUT_INVALID');
  }
}

function validateApplyNpcBattleActionInput(
  value: unknown,
): asserts value is ApplyNpcBattleActionInput {
  if (
    !plainObject(value) ||
    !hasExactKeys(value, ['principal', 'action']) ||
    !isExactPrincipal(value.principal)
  ) {
    throw new MatchBattleError('MATCH_BATTLE_INPUT_INVALID');
  }
}

function samePrincipal(row: BattleLifecycleRow, principal: MatchSessionPrincipal): boolean {
  return (
    row.account_id === principal.accountId &&
    row.session_id === principal.sessionId &&
    row.session_version === principal.sessionVersion
  );
}

function isLifecycleState(value: string): value is NpcBattleLifecycleState {
  return (
    value === 'provisioning' ||
    value === 'active' ||
    value === 'finished' ||
    value === 'cancelled' ||
    value === 'abandoned'
  );
}

function isCancellationReason(value: unknown): value is NpcBattleCancellationReason {
  return value === 'server_cancelled' || value === 'start_failed';
}

function isAbandonReason(value: unknown): value is NpcBattleAbandonReason {
  return value === 'player_abandoned';
}

function terminalReleaseDeadlineKey(registrationId: string): string {
  return `coordinator-terminal-release:${registrationId}`;
}

function isSeatId(value: unknown): value is MatchSeatId {
  return value === 'player-1' || value === 'player-2';
}

function internalPrincipal(request: Request): MatchSessionPrincipal | null {
  const accountId = request.headers.get(INTERNAL_ACCOUNT_ID_HEADER);
  const sessionId = request.headers.get(INTERNAL_SESSION_ID_HEADER);
  const rawVersion = request.headers.get(INTERNAL_SESSION_VERSION_HEADER);
  if (
    !accountId ||
    !sessionId ||
    !rawVersion ||
    !/^[1-9][0-9]{0,15}$/.test(rawVersion)
  ) {
    return null;
  }
  const principal = {
    accountId,
    sessionId,
    sessionVersion: Number(rawVersion),
  };
  return isPrincipal(principal) ? principal : null;
}

function isDigestCandidate(value: TokenDigestCandidate): boolean {
  return (
    DIGEST_PATTERN.test(value.digestHex) &&
    Number.isSafeInteger(value.keyVersion) &&
    value.keyVersion >= 1 &&
    value.keyVersion <= 32_767
  );
}

function validateCandidates(
  candidates: readonly TokenDigestCandidate[],
): readonly TokenDigestCandidate[] {
  if (candidates.length < 1 || candidates.length > 8) {
    throw new TypeError('SEAT_TOKEN_CANDIDATES_INVALID');
  }
  const identities = new Set<string>();
  for (const candidate of candidates) {
    if (!isDigestCandidate(candidate)) throw new TypeError('SEAT_TOKEN_CANDIDATES_INVALID');
    const identity = `${candidate.keyVersion}:${candidate.digestHex}`;
    if (identities.has(identity)) throw new TypeError('SEAT_TOKEN_CANDIDATES_INVALID');
    identities.add(identity);
  }
  return candidates;
}

function pendingDeadlineKey(connectionId: string): string {
  return `ws-auth:${connectionId}`;
}

function referenceCleanupDeadlineKey(registrationId: string): string {
  return `coordinator-cleanup:${registrationId}`;
}

function referenceCleanupRetryDelayMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(16, attempt - 1));
  return Math.min(
    REFERENCE_CLEANUP_RETRY_MAX_MS,
    REFERENCE_CLEANUP_RETRY_BASE_MS * 2 ** exponent,
  );
}

export function matchIdFromPath(pathname: string): string | null {
  return pathname.match(MATCH_PATH)?.[1] ?? null;
}

/**
 * MatchDOはmatchごとのassignment/token/connection正本。
 * browser公開NPC経路はserver予約由来だけにし、Workerの参加台帳とlocal assignmentの
 * 二重barrierを通らないsessionにはtokenを発行しない。
 */
export class MatchDO extends DurableObject<Env> {
  private operationTail: Promise<void> = Promise.resolve();
  private battleRuntime: EngineBattleAdapter | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS match_seat_assignment (
          seat_id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          session_version INTEGER NOT NULL,
          assignment_version INTEGER NOT NULL,
          coordinator_registration_id TEXT NOT NULL,
          coordinator_registration_epoch_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          CHECK (seat_id IN ('player-1', 'player-2')),
          CHECK (session_version >= 1),
          CHECK (assignment_version >= 1),
          CHECK (coordinator_registration_epoch_ms >= 1)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS match_seat_assignment_account
          ON match_seat_assignment(account_id);
        CREATE UNIQUE INDEX IF NOT EXISTS match_seat_assignment_session
          ON match_seat_assignment(session_id);
        CREATE TABLE IF NOT EXISTS match_seat_token (
          token_digest TEXT NOT NULL,
          digest_key_version INTEGER NOT NULL,
          seat_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          session_version INTEGER NOT NULL,
          assignment_version INTEGER NOT NULL,
          issued_at_ms INTEGER NOT NULL,
          expires_at_ms INTEGER NOT NULL,
          consumed_at_ms INTEGER,
          PRIMARY KEY (token_digest, digest_key_version),
          CHECK (seat_id IN ('player-1', 'player-2')),
          CHECK (digest_key_version BETWEEN 1 AND 32767),
          CHECK (expires_at_ms > issued_at_ms)
        );
        CREATE INDEX IF NOT EXISTS match_seat_token_assignment
          ON match_seat_token(seat_id, assignment_version, expires_at_ms);
        CREATE TABLE IF NOT EXISTS match_session_invalidation (
          session_id TEXT PRIMARY KEY,
          invalidated_version INTEGER NOT NULL,
          invalidated_at_ms INTEGER NOT NULL,
          CHECK (invalidated_version >= 1)
        );
        CREATE TABLE IF NOT EXISTS do_deadline (
          deadline_key TEXT PRIMARY KEY,
          deadline_kind TEXT NOT NULL,
          due_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS do_deadline_due ON do_deadline(due_at_ms);
        CREATE TABLE IF NOT EXISTS match_reference_cleanup (
          registration_id TEXT PRIMARY KEY,
          registration_epoch_ms INTEGER NOT NULL,
          seat_id TEXT NOT NULL UNIQUE,
          account_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          session_version INTEGER NOT NULL,
          match_id TEXT NOT NULL,
          work_kind TEXT NOT NULL,
          retry_attempt INTEGER NOT NULL DEFAULT 0,
          CHECK (seat_id IN ('player-1', 'player-2')),
          CHECK (work_kind IN ('pending_assignment', 'cleanup')),
          CHECK (registration_epoch_ms >= 1),
          CHECK (session_version >= 1),
          CHECK (retry_attempt >= 0)
        );
        CREATE TABLE IF NOT EXISTS match_reference_clock (
          clock_key INTEGER PRIMARY KEY CHECK (clock_key = 1),
          last_epoch_ms INTEGER NOT NULL CHECK (last_epoch_ms >= 1)
        );
        CREATE TABLE IF NOT EXISTS match_battle_lifecycle (
          lifecycle_key INTEGER PRIMARY KEY CHECK (lifecycle_key = 1),
          match_id TEXT NOT NULL UNIQUE,
          lifecycle_state TEXT NOT NULL,
          account_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          session_version INTEGER NOT NULL,
          seat_id TEXT NOT NULL,
          assignment_version INTEGER,
          seed INTEGER NOT NULL,
          adapter_version INTEGER NOT NULL,
          engine_version TEXT NOT NULL,
          content_version TEXT NOT NULL,
          format_version_id TEXT NOT NULL,
          npc_policy_id TEXT NOT NULL,
          started_at_ms INTEGER NOT NULL,
          terminal_at_ms INTEGER,
          terminal_reason TEXT,
          winner INTEGER,
          engine_end_reason TEXT,
          turns INTEGER,
          final_state_hash TEXT,
          applied_actions INTEGER,
          CHECK (lifecycle_state IN (
            'provisioning', 'active', 'finished', 'cancelled', 'abandoned'
          )),
          CHECK (seat_id = 'player-1'),
          CHECK (session_version >= 1),
          CHECK (assignment_version IS NULL OR assignment_version >= 1),
          CHECK (seed BETWEEN 0 AND 4294967295),
          CHECK (adapter_version >= 1),
          CHECK (started_at_ms >= 1),
          CHECK (terminal_at_ms IS NULL OR terminal_at_ms >= started_at_ms),
          CHECK (winner IS NULL OR winner IN (0, 1)),
          CHECK (turns IS NULL OR turns >= 0),
          CHECK (applied_actions IS NULL OR applied_actions >= 0)
        );
        CREATE TABLE IF NOT EXISTS match_terminal_release (
          seat_id TEXT PRIMARY KEY,
          registration_id TEXT NOT NULL UNIQUE,
          registration_epoch_ms INTEGER NOT NULL,
          account_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          session_version INTEGER NOT NULL,
          match_id TEXT NOT NULL,
          seed INTEGER NOT NULL,
          release_phase TEXT NOT NULL,
          retry_attempt INTEGER NOT NULL DEFAULT 0,
          CHECK (seat_id IN ('player-1', 'player-2')),
          CHECK (registration_epoch_ms >= 1),
          CHECK (session_version >= 1),
          CHECK (seed BETWEEN 0 AND 4294967295),
          CHECK (release_phase IN (
            'unregister_pending', 'reservation_release_pending'
          )),
          CHECK (retry_attempt >= 0)
        );
      `);
      const assignmentColumns = this.ctx.storage.sql.exec<{ name: string }>(
        `PRAGMA table_info(match_seat_assignment)`,
      ).toArray();
      if (!assignmentColumns.some((column) => column.name === 'coordinator_registration_id')) {
        this.ctx.storage.sql.exec(
          `ALTER TABLE match_seat_assignment
             ADD COLUMN coordinator_registration_id TEXT`,
        );
      }
      if (!assignmentColumns.some((column) => column.name === 'coordinator_registration_epoch_ms')) {
        this.ctx.storage.sql.exec(
          `ALTER TABLE match_seat_assignment
             ADD COLUMN coordinator_registration_epoch_ms INTEGER`,
        );
        this.ctx.storage.sql.exec(
          `UPDATE match_seat_assignment
              SET coordinator_registration_epoch_ms = updated_at_ms
            WHERE coordinator_registration_id IS NOT NULL
              AND coordinator_registration_epoch_ms IS NULL`,
        );
      }
    });
  }

  async sqliteReady(): Promise<boolean> {
    return this.ctx.storage.sql.exec<{ ok: number }>('SELECT 1 AS ok').one().ok === 1;
  }

  /** Worker内部だけが呼ぶ。match ID・seed・deck/versionはbrowser入力にしない。 */
  async startNpcBattle(input: StartNpcBattleInput): Promise<StartNpcBattleResult> {
    validateStartNpcBattleInput(input);
    if (!this.ctx.id.name || !NPC_MATCH_ID_PATTERN.test(this.ctx.id.name)) {
      throw new MatchBattleError('MATCH_BATTLE_INPUT_INVALID');
    }
    return this.withOperationLock(() => this.startNpcBattleExclusive(input));
  }

  /** OLG-123のstable MatchActionを内部RPCで扱う。browser wireはOLG-122/125/124まで開かない。 */
  async applyNpcBattleAction(
    input: ApplyNpcBattleActionInput,
  ): Promise<ApplyNpcBattleActionResult> {
    validateApplyNpcBattleActionInput(input);
    return this.withOperationLock(async () => {
      let lifecycle = this.requireBattleLifecycle(input.principal, true);
      if (lifecycle.lifecycle_state === 'provisioning') {
        throw new MatchBattleError('MATCH_STATE_UNAVAILABLE');
      }
      if (lifecycle.lifecycle_state !== 'active') {
        throw new MatchBattleError('MATCH_BATTLE_ALREADY_TERMINAL');
      }
      const runtime = this.requireBattleRuntime();
      const alreadyFinished = runtime.result();
      if (alreadyFinished) {
        lifecycle = await this.persistBattleTerminal(
          lifecycle,
          this.finishedTerminalResult(alreadyFinished),
        );
        throw new MatchBattleError('MATCH_BATTLE_ALREADY_TERMINAL');
      }

      const transition = runtime.applyHumanAction(input.action);
      const result = runtime.result();
      if (result) {
        await this.persistBattleTerminal(lifecycle, this.finishedTerminalResult(result));
      }
      return {
        state: 'applied',
        transition,
        lifecycleState: result ? 'finished' : 'active',
      };
    });
  }

  /** 相手手札・山札・seedを含むため、OLG-124のprojection前はRPC内部専用。 */
  async getNpcBattleSnapshot(
    principal: MatchSessionPrincipal,
  ): Promise<AuthoritativeBattleSnapshot> {
    if (!isExactPrincipal(principal)) {
      throw new MatchBattleError('MATCH_BATTLE_INPUT_INVALID');
    }
    return this.withOperationLock(async () => {
      const lifecycle = await this.reconcileFinishedRuntime(
        this.requireBattleLifecycle(principal, true),
      );
      if (lifecycle.lifecycle_state !== 'active') {
        throw new MatchBattleError('MATCH_BATTLE_ALREADY_TERMINAL');
      }
      return this.requireBattleRuntime().authoritativeSnapshot();
    });
  }

  async getNpcBattleLifecycle(principal: MatchSessionPrincipal): Promise<NpcBattleLifecycle> {
    if (!isExactPrincipal(principal)) {
      throw new MatchBattleError('MATCH_BATTLE_INPUT_INVALID');
    }
    return this.withOperationLock(async () => {
      const lifecycle = await this.reconcileFinishedRuntime(
        this.requireBattleLifecycle(principal, false),
      );
      if (lifecycle.lifecycle_state === 'active' && this.battleRuntime === null) {
        throw new MatchBattleError('MATCH_STATE_UNAVAILABLE');
      }
      return this.lifecycleFromRow(lifecycle);
    });
  }

  async getNpcBattleResult(
    principal: MatchSessionPrincipal,
  ): Promise<NpcBattleTerminalResult | null> {
    if (!isExactPrincipal(principal)) {
      throw new MatchBattleError('MATCH_BATTLE_INPUT_INVALID');
    }
    return this.withOperationLock(async () => {
      const lifecycle = await this.reconcileFinishedRuntime(
        this.requireBattleLifecycle(principal, false),
      );
      if (lifecycle.lifecycle_state === 'active' && this.battleRuntime === null) {
        throw new MatchBattleError('MATCH_STATE_UNAVAILABLE');
      }
      return this.lifecycleFromRow(lifecycle).terminalResult;
    });
  }

  async cancelNpcBattle(input: {
    principal: MatchSessionPrincipal;
    reason: NpcBattleCancellationReason;
  }): Promise<NpcBattleLifecycle> {
    if (
      !plainObject(input) ||
      !hasExactKeys(input, ['principal', 'reason']) ||
      !isExactPrincipal(input.principal) ||
      !isCancellationReason(input.reason)
    ) {
      throw new MatchBattleError('MATCH_BATTLE_INPUT_INVALID');
    }
    return this.withOperationLock(async () => {
      let lifecycle = this.requireBattleLifecycle(input.principal, false);
      if (lifecycle.lifecycle_state === 'cancelled') {
        const stored = this.lifecycleFromRow(lifecycle);
        if (stored.terminalResult?.kind === 'cancelled' && stored.terminalResult.reason === input.reason) {
          return stored;
        }
        throw new MatchBattleError('MATCH_BATTLE_ALREADY_TERMINAL');
      }
      if (lifecycle.lifecycle_state !== 'provisioning' && lifecycle.lifecycle_state !== 'active') {
        throw new MatchBattleError('MATCH_BATTLE_ALREADY_TERMINAL');
      }
      if (lifecycle.lifecycle_state === 'active' && this.battleRuntime === null) {
        throw new MatchBattleError('MATCH_STATE_UNAVAILABLE');
      }
      const finished = this.battleRuntime?.result() ?? null;
      if (finished) {
        await this.persistBattleTerminal(
          lifecycle,
          this.finishedTerminalResult(finished),
        );
        throw new MatchBattleError('MATCH_BATTLE_ALREADY_TERMINAL');
      }
      const status = this.battleRuntime?.status() ?? null;
      lifecycle = await this.persistBattleTerminal(lifecycle, {
        kind: 'cancelled',
        winner: null,
        reason: input.reason,
        turns: status?.turn ?? null,
        finalStateHash: status?.stateHash ?? null,
        appliedActions: status?.appliedActions ?? null,
      });
      return this.lifecycleFromRow(lifecycle);
    });
  }

  async abandonNpcBattle(input: {
    principal: MatchSessionPrincipal;
    reason: NpcBattleAbandonReason;
  }): Promise<NpcBattleLifecycle> {
    if (
      !plainObject(input) ||
      !hasExactKeys(input, ['principal', 'reason']) ||
      !isExactPrincipal(input.principal) ||
      !isAbandonReason(input.reason)
    ) {
      throw new MatchBattleError('MATCH_BATTLE_INPUT_INVALID');
    }
    return this.withOperationLock(async () => {
      let lifecycle = this.requireBattleLifecycle(input.principal, true);
      if (lifecycle.lifecycle_state === 'abandoned') {
        const stored = this.lifecycleFromRow(lifecycle);
        if (stored.terminalResult?.kind === 'abandoned' && stored.terminalResult.reason === input.reason) {
          return stored;
        }
        throw new MatchBattleError('MATCH_BATTLE_ALREADY_TERMINAL');
      }
      if (lifecycle.lifecycle_state !== 'active') {
        throw new MatchBattleError('MATCH_BATTLE_ALREADY_TERMINAL');
      }
      const runtime = this.requireBattleRuntime();
      const finished = runtime.result();
      if (finished) {
        lifecycle = await this.persistBattleTerminal(
          lifecycle,
          this.finishedTerminalResult(finished),
        );
        throw new MatchBattleError('MATCH_BATTLE_ALREADY_TERMINAL');
      }
      const status = runtime.status();
      lifecycle = await this.persistBattleTerminal(lifecycle, {
        kind: 'abandoned',
        winner: NPC_PLAYER,
        reason: input.reason,
        turns: status.turn,
        finalStateHash: status.stateHash,
        appliedActions: status.appliedActions,
      });
      return this.lifecycleFromRow(lifecycle);
    });
  }

  async assignSeat(
    input: MatchSessionPrincipal & { seatId: MatchSeatId },
  ): Promise<SeatAssignmentResult> {
    if (!isPrincipal(input) || !isSeatId(input.seatId)) {
      throw new TypeError('MATCH_SEAT_ASSIGNMENT_INVALID');
    }
    return this.withOperationLock(() => this.assignSeatExclusive(input));
  }

  private async assignSeatExclusive(
    input: MatchSessionPrincipal & { seatId: MatchSeatId },
  ): Promise<SeatAssignmentResult> {
    const matchId = this.ctx.id.name;
    if (!matchId || !MATCH_ID_PATTERN.test(matchId)) {
      throw new TypeError('MATCH_IDENTITY_INVALID');
    }

    const lifecycle = this.battleLifecycleRow();
    if (
      lifecycle &&
      (lifecycle.lifecycle_state === 'finished' ||
        lifecycle.lifecycle_state === 'cancelled' ||
        lifecycle.lifecycle_state === 'abandoned' ||
        input.seatId !== 'player-1' ||
        !samePrincipal(lifecycle, input))
    ) {
      return { state: 'conflict' };
    }

    if (this.hasLocalAssignmentConflict(input)) return { state: 'conflict' };

    const exactAssignment = this.ctx.storage.sql.exec<AssignmentReferenceRow>(
      `SELECT seat_id, account_id, session_id, session_version, assignment_version,
              coordinator_registration_id, coordinator_registration_epoch_ms
         FROM match_seat_assignment
        WHERE seat_id = ? AND account_id = ? AND session_id = ? AND session_version = ?`,
      input.seatId,
      input.accountId,
      input.sessionId,
      input.sessionVersion,
    ).toArray()[0];
    const coordinator = sessionCoordinatorStub(this.env, input.sessionId);
    if (
      exactAssignment &&
      typeof exactAssignment.coordinator_registration_id === 'string' &&
      UUID_PATTERN.test(exactAssignment.coordinator_registration_id) &&
      positiveInteger(exactAssignment.coordinator_registration_epoch_ms)
    ) {
      const reference: SessionMatchReferenceInput = {
        sessionId: input.sessionId,
        sessionVersion: input.sessionVersion,
        matchId,
        registrationId: exactAssignment.coordinator_registration_id,
        registrationEpochMs: exactAssignment.coordinator_registration_epoch_ms,
      };
      const status = await coordinator.checkMatch(reference);
      if (status.state === 'invalidated') {
        await this.invalidateSessionExclusive({
          sessionId: input.sessionId,
          invalidatedVersion: status.invalidatedVersion,
        });
        return { state: 'conflict' };
      }
      return status.state === 'registered' &&
        this.assignmentOwnsReference({
          seatId: input.seatId,
          accountId: input.accountId,
          ...reference,
        }) &&
        !this.hasLocalAssignmentConflict(input)
        ? {
            state: 'assigned',
            seatId: input.seatId,
            assignmentVersion: exactAssignment.assignment_version,
          }
        : { state: 'conflict' };
    }

    const pending = this.referenceWorkForSeat(input.seatId);
    let reference: MatchReferenceWork;
    if (
      pending?.work_kind === 'pending_assignment' &&
      pending.account_id === input.accountId &&
      pending.session_id === input.sessionId &&
      pending.session_version === input.sessionVersion &&
      pending.match_id === matchId
    ) {
      reference = this.referenceWorkFromRow(pending);
    } else {
      if (pending) {
        const cleaned = await this.retryReferenceCleanup(
          referenceCleanupDeadlineKey(pending.registration_id),
        );
        if (!cleaned) return { state: 'conflict' };
      }
      reference = {
        seatId: input.seatId,
        accountId: input.accountId,
        sessionId: input.sessionId,
        sessionVersion: input.sessionVersion,
        matchId,
        registrationId: crypto.randomUUID(),
        registrationEpochMs: this.nextReferenceEpoch(),
      };
      await this.persistPendingReference(reference);
    }

    let registration: SessionMatchRegistrationResult;
    try {
      registration = await coordinator.registerMatch(reference);
    } catch (error) {
      await this.scheduleReferenceCleanup(reference);
      throw error;
    }
    if (registration.state === 'invalidated') {
      this.clearReferenceCleanup(reference.registrationId);
      await this.invalidateSessionExclusive({
        sessionId: input.sessionId,
        invalidatedVersion: registration.invalidatedVersion,
      });
      return { state: 'conflict' };
    }
    if (registration.state === 'cancelled') {
      this.advanceReferenceEpoch(registration.cancelledThroughEpochMs);
      this.clearReferenceCleanup(reference.registrationId);
      return { state: 'conflict' };
    }
    if (registration.state === 'capacity_exceeded') {
      this.clearReferenceCleanup(reference.registrationId);
      return { state: 'conflict' };
    }

    let committed: {
      result: SeatAssignmentResult;
      referenceInstalled: boolean;
      displacedReference: MatchReferenceWork | null;
    };
    try {
      committed = await this.ctx.storage.transaction(async (transaction) => {
        const invalidation = this.ctx.storage.sql.exec<{ invalidated_version: number }>(
          `SELECT invalidated_version FROM match_session_invalidation WHERE session_id = ?`,
          input.sessionId,
        ).toArray()[0];
        if (invalidation && invalidation.invalidated_version > input.sessionVersion) {
          return {
            result: { state: 'conflict' } as const,
            referenceInstalled: false,
            displacedReference: null,
          };
        }

        const duplicate = this.ctx.storage.sql.exec<AssignmentRow>(
          `SELECT seat_id, account_id, session_id, session_version, assignment_version
             FROM match_seat_assignment
            WHERE (account_id = ? OR session_id = ?) AND seat_id <> ?`,
          input.accountId,
          input.sessionId,
          input.seatId,
        ).toArray();
        if (duplicate.length > 0) {
          return {
            result: { state: 'conflict' } as const,
            referenceInstalled: false,
            displacedReference: null,
          };
        }

        const current = this.ctx.storage.sql.exec<AssignmentReferenceRow>(
          `SELECT seat_id, account_id, session_id, session_version, assignment_version,
                  coordinator_registration_id, coordinator_registration_epoch_ms
             FROM match_seat_assignment WHERE seat_id = ?`,
          input.seatId,
        ).toArray()[0];
        const currentIsExact = Boolean(
          current &&
          current.account_id === input.accountId &&
          current.session_id === input.sessionId &&
          current.session_version === input.sessionVersion
        );
        if (current?.session_id === input.sessionId && current.account_id !== input.accountId) {
          return {
            result: { state: 'conflict' } as const,
            referenceInstalled: false,
            displacedReference: null,
          };
        }
        if (
          current?.session_id === input.sessionId &&
          current.account_id === input.accountId &&
          current.session_version > input.sessionVersion
        ) {
          return {
            result: { state: 'conflict' } as const,
            referenceInstalled: false,
            displacedReference: null,
          };
        }
        if (currentIsExact && current) {
          if (
            typeof current.coordinator_registration_id === 'string' &&
            UUID_PATTERN.test(current.coordinator_registration_id) &&
            positiveInteger(current.coordinator_registration_epoch_ms)
          ) {
            return {
              result: {
                state: 'assigned',
                seatId: input.seatId,
                assignmentVersion: current.assignment_version,
              } as const,
              referenceInstalled:
                current.coordinator_registration_id === reference.registrationId &&
                current.coordinator_registration_epoch_ms === reference.registrationEpochMs,
              displacedReference: null,
            };
          }
          this.ctx.storage.sql.exec(
            `UPDATE match_seat_assignment
                SET coordinator_registration_id = ?,
                    coordinator_registration_epoch_ms = ?, updated_at_ms = ?
              WHERE seat_id = ? AND assignment_version = ?`,
            reference.registrationId,
            reference.registrationEpochMs,
            Date.now(),
            input.seatId,
            current.assignment_version,
          );
          await this.commitReferenceInstallation(transaction, reference, null);
          return {
            result: {
              state: 'assigned',
              seatId: input.seatId,
              assignmentVersion: current.assignment_version,
            } as const,
            referenceInstalled: true,
            displacedReference: null,
          };
        }

        const assignmentVersion = (current?.assignment_version ?? 0) + 1;
        const displacedReference =
          current &&
          typeof current.coordinator_registration_id === 'string' &&
          UUID_PATTERN.test(current.coordinator_registration_id) &&
          positiveInteger(current.coordinator_registration_epoch_ms)
            ? {
                seatId: input.seatId,
                accountId: current.account_id,
                sessionId: current.session_id,
                sessionVersion: current.session_version,
                matchId,
                registrationId: current.coordinator_registration_id,
                registrationEpochMs: current.coordinator_registration_epoch_ms,
              }
            : null;
        this.ctx.storage.sql.exec(
          `DELETE FROM match_seat_token WHERE seat_id = ?`,
          input.seatId,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO match_seat_assignment (
             seat_id, account_id, session_id, session_version, assignment_version,
             coordinator_registration_id, coordinator_registration_epoch_ms, updated_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(seat_id) DO UPDATE SET
             account_id = excluded.account_id,
             session_id = excluded.session_id,
             session_version = excluded.session_version,
             assignment_version = excluded.assignment_version,
             coordinator_registration_id = excluded.coordinator_registration_id,
             coordinator_registration_epoch_ms = excluded.coordinator_registration_epoch_ms,
             updated_at_ms = excluded.updated_at_ms`,
          input.seatId,
          input.accountId,
          input.sessionId,
          input.sessionVersion,
          assignmentVersion,
          reference.registrationId,
          reference.registrationEpochMs,
          Date.now(),
        );
        await this.commitReferenceInstallation(
          transaction,
          reference,
          displacedReference,
        );
        return {
          result: { state: 'assigned', seatId: input.seatId, assignmentVersion } as const,
          referenceInstalled: true,
          displacedReference,
        };
      });
    } catch (error) {
      if (!this.assignmentOwnsReference(reference)) {
        await this.scheduleReferenceCleanup(reference);
      }
      throw error;
    }

    if (committed.result.state === 'assigned') {
      this.closeStaleSeatConnections(
        committed.result.seatId,
        committed.result.assignmentVersion,
      );
    }
    if (!committed.referenceInstalled && !this.assignmentOwnsReference(reference)) {
      await this.unregisterReference(reference, coordinator);
    }
    if (committed.displacedReference) {
      await this.unregisterReference(committed.displacedReference);
    }
    return committed.result;
  }

  async issueSeatToken(principal: MatchSessionPrincipal): Promise<SeatTokenIssueResult> {
    if (!isPrincipal(principal)) throw new TypeError('MATCH_SESSION_PRINCIPAL_INVALID');
    const config = createSessionRuntimeConfig(this.env);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const seatToken = generateSeatToken();
      const tokenDigest = await seatTokenDigestHex(seatToken, config.cryptoKeys.activeHmac);
      const result = this.ctx.storage.transactionSync(() => {
          const now = Date.now();
          this.ctx.storage.sql.exec(
            `DELETE FROM match_seat_token
              WHERE expires_at_ms <= ? OR consumed_at_ms IS NOT NULL`,
            now,
          );
          const existingDigest = this.ctx.storage.sql.exec<{ found: number }>(
            `SELECT 1 AS found FROM match_seat_token
              WHERE token_digest = ? AND digest_key_version = ?`,
            tokenDigest,
            config.cryptoKeys.activeHmac.keyVersion,
          ).toArray();
          if (existingDigest.length > 0) return { state: 'collision' } as const;
          const assignment = this.ctx.storage.sql.exec<AssignmentRow>(
            `SELECT assignment.seat_id, assignment.account_id, assignment.session_id,
                    assignment.session_version, assignment.assignment_version
               FROM match_seat_assignment AS assignment
              WHERE assignment.account_id = ?
                AND assignment.session_id = ?
                AND assignment.session_version = ?
                AND assignment.coordinator_registration_id IS NOT NULL
                AND assignment.coordinator_registration_epoch_ms IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM match_session_invalidation AS invalidation
                   WHERE invalidation.session_id = assignment.session_id
                     AND invalidation.invalidated_version > assignment.session_version
                )`,
            principal.accountId,
            principal.sessionId,
            principal.sessionVersion,
          ).toArray();
          if (assignment.length !== 1) return { state: 'not_assigned' } as const;
          const active = this.ctx.storage.sql.exec<{ active_count: number }>(
            `SELECT COUNT(*) AS active_count FROM match_seat_token
              WHERE seat_id = ? AND assignment_version = ?
                AND consumed_at_ms IS NULL AND expires_at_ms > ?`,
            assignment[0]!.seat_id,
            assignment[0]!.assignment_version,
            now,
          ).one().active_count;
          if (active >= MAX_OUTSTANDING_SEAT_TOKENS) {
            return { state: 'rate_limited' } as const;
          }
          const expiresAtEpochMs = now + SEAT_TOKEN_TTL_MS;
          this.ctx.storage.sql.exec(
            `INSERT INTO match_seat_token (
               token_digest, digest_key_version, seat_id, account_id, session_id,
               session_version, assignment_version, issued_at_ms, expires_at_ms
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            tokenDigest,
            config.cryptoKeys.activeHmac.keyVersion,
            assignment[0]!.seat_id,
            assignment[0]!.account_id,
            assignment[0]!.session_id,
            assignment[0]!.session_version,
            assignment[0]!.assignment_version,
            now,
            expiresAtEpochMs,
          );
          return { state: 'issued', seatToken, expiresAtEpochMs } as const;
      });
      if (result.state === 'collision') continue;
      return result;
    }
    throw new Error('SEAT_TOKEN_ISSUE_UNAVAILABLE');
  }

  consumeSeatTokenCandidates(
    candidates: readonly TokenDigestCandidate[],
    principal: MatchSessionPrincipal,
    context: {
      connectionId: string;
      authDeadlineEpochMs: number;
      now?: number;
    },
  ): SeatTokenConsumeResult {
    validateCandidates(candidates);
    const now = context.now ?? Date.now();
    if (
      !isPrincipal(principal) ||
      !UUID_PATTERN.test(context.connectionId) ||
      !Number.isSafeInteger(context.authDeadlineEpochMs) ||
      context.authDeadlineEpochMs < 1 ||
      !Number.isSafeInteger(now) ||
      now < 0
    ) {
      throw new TypeError('SEAT_TOKEN_CONSUME_INVALID');
    }
    return this.ctx.storage.transactionSync(() => {
      const matches: TokenMatchRow[] = [];
      for (const candidate of candidates) {
        matches.push(
          ...this.ctx.storage.sql.exec<TokenMatchRow>(
            `SELECT token.token_digest, token.digest_key_version, token.seat_id,
                    token.assignment_version
               FROM match_seat_token AS token
               JOIN match_seat_assignment AS assignment
                 ON assignment.seat_id = token.seat_id
                AND assignment.assignment_version = token.assignment_version
                AND assignment.account_id = token.account_id
                AND assignment.session_id = token.session_id
                AND assignment.session_version = token.session_version
              WHERE token.token_digest = ?
                AND token.digest_key_version = ?
                AND token.account_id = ?
                AND token.session_id = ?
                AND token.session_version = ?
                AND token.consumed_at_ms IS NULL
                AND token.expires_at_ms > ?
                AND EXISTS (
                  SELECT 1 FROM do_deadline AS deadline
                   WHERE deadline.deadline_key = ?
                     AND deadline.deadline_kind = 'ws-auth'
                     AND deadline.due_at_ms = ?
                     AND deadline.due_at_ms > ?
                )
                AND NOT EXISTS (
                  SELECT 1 FROM match_session_invalidation AS invalidation
                   WHERE invalidation.session_id = token.session_id
                     AND invalidation.invalidated_version > token.session_version
                )`,
            candidate.digestHex,
            candidate.keyVersion,
            principal.accountId,
            principal.sessionId,
            principal.sessionVersion,
            now,
            pendingDeadlineKey(context.connectionId),
            context.authDeadlineEpochMs,
            now,
          ).toArray(),
        );
      }
      if (matches.length === 0) return { state: 'invalid' } as const;
      if (matches.length > 1) return { state: 'ambiguous' } as const;
      const match = matches[0]!;
      const consumed = this.ctx.storage.sql.exec<{
        seat_id: string;
        assignment_version: number;
      }>(
        `UPDATE match_seat_token
            SET consumed_at_ms = ?
          WHERE token_digest = ?
            AND digest_key_version = ?
            AND consumed_at_ms IS NULL
            AND expires_at_ms > ?
          RETURNING seat_id, assignment_version`,
        now,
        match.token_digest,
        match.digest_key_version,
        now,
      ).toArray();
      if (consumed.length !== 1 || !isSeatId(consumed[0]!.seat_id)) {
        return { state: 'invalid' } as const;
      }
      return {
        state: 'consumed',
        seatId: consumed[0]!.seat_id,
        assignmentVersion: consumed[0]!.assignment_version,
      } as const;
    });
  }

  async invalidateSession(input: {
    sessionId: string;
    invalidatedVersion: number;
  }): Promise<{ state: 'acknowledged'; closedConnections: number }> {
    if (!UUID_PATTERN.test(input.sessionId) || !positiveInteger(input.invalidatedVersion)) {
      throw new TypeError('SESSION_INVALIDATION_INVALID');
    }
    return this.withOperationLock(() => this.invalidateSessionExclusive(input));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: { Allow: 'GET' } });
    }
    if (!isWebSocketUpgrade(request)) {
      return json({ error: 'WEBSOCKET_UPGRADE_REQUIRED' }, { status: 426 });
    }
    const url = new URL(request.url);
    const matchId = matchIdFromPath(url.pathname);
    if (!matchId || url.search !== '' || this.ctx.id.name !== matchId) {
      return json({ error: 'INVALID_MATCH_PATH' }, { status: 400 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    if (this.env.APP_ENV === 'local' && matchId === 'local-smoke') {
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ mode: 'diagnostic', matchId } satisfies DiagnosticAttachment);
      return new Response(null, { status: 101, webSocket: client });
    }

    const principal = internalPrincipal(request);
    if (!principal) return json({ error: 'SESSION_REQUIRED' }, { status: 401 });
    const connectionId = crypto.randomUUID();
    const authDeadlineEpochMs = Date.now() + SEAT_AUTH_FRAME_TIMEOUT_MS;
    this.ctx.storage.sql.exec(
      `INSERT INTO do_deadline (deadline_key, deadline_kind, due_at_ms)
       VALUES (?, 'ws-auth', ?)`,
      pendingDeadlineKey(connectionId),
      authDeadlineEpochMs,
    );
    try {
      await this.ensureNextAlarm();
    } catch {
      this.ctx.storage.sql.exec(
        `DELETE FROM do_deadline WHERE deadline_key = ?`,
        pendingDeadlineKey(connectionId),
      );
      return json({ error: 'MATCH_UNAVAILABLE' }, { status: 503 });
    }
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      mode: 'pending',
      matchId,
      connectionId,
      authDeadlineEpochMs,
      ...principal,
    } satisfies PendingAttachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
    if (!attachment) {
      socket.close(AUTHENTICATION_CLOSE_CODE, AUTHENTICATION_CLOSE_REASON);
      return;
    }
    if (attachment.mode === 'diagnostic') {
      if (typeof message !== 'string' || !message.startsWith(PROBE_PREFIX)) {
        socket.send('error:probe-only');
        return;
      }
      socket.send(`probe_ack:${attachment.matchId}:${message.slice(PROBE_PREFIX.length)}`);
      return;
    }
    if (attachment.mode === 'authenticated') {
      const invalidated = this.ctx.storage.sql.exec<{ invalidated_version: number }>(
        `SELECT invalidated_version FROM match_session_invalidation WHERE session_id = ?`,
        attachment.sessionId,
      ).toArray()[0];
      if (invalidated && invalidated.invalidated_version > attachment.sessionVersion) {
        socket.close(AUTHENTICATION_CLOSE_CODE, SESSION_CLOSE_REASON);
        return;
      }
      if (!this.isCurrentAssignment(attachment)) {
        socket.close(AUTHENTICATION_CLOSE_CODE, SEAT_CLOSE_REASON);
        return;
      }
      socket.send('error:game-not-ready');
      return;
    }

    if (attachment.mode === 'verifying') {
      await this.rejectPendingSocket(socket, attachment);
      return;
    }

    const now = Date.now();
    if (now >= attachment.authDeadlineEpochMs) {
      await this.rejectPendingSocket(socket, attachment);
      return;
    }
    try {
      const verifying = {
        ...attachment,
        mode: 'verifying',
      } satisfies VerifyingAttachment;
      socket.serializeAttachment(verifying);
      const frame = parseSeatAuthFrame(message);
      const config = createSessionRuntimeConfig(this.env);
      const candidates = await seatTokenDigestCandidates(frame.seatToken, config.cryptoKeys);
      const consumed = this.consumeSeatTokenCandidates(candidates, verifying, {
        connectionId: verifying.connectionId,
        authDeadlineEpochMs: verifying.authDeadlineEpochMs,
      });
      if (consumed.state !== 'consumed') {
        await this.rejectPendingSocket(socket, verifying);
        return;
      }
      socket.serializeAttachment({
        mode: 'authenticated',
        matchId: verifying.matchId,
        connectionId: verifying.connectionId,
        accountId: verifying.accountId,
        sessionId: verifying.sessionId,
        sessionVersion: verifying.sessionVersion,
        seatId: consumed.seatId,
        assignmentVersion: consumed.assignmentVersion,
      } satisfies AuthenticatedAttachment);
      this.ctx.storage.sql.exec(
        `DELETE FROM do_deadline WHERE deadline_key = ?`,
        pendingDeadlineKey(verifying.connectionId),
      );
      await this.ensureNextAlarm();
      socket.send('auth_ok');
    } catch {
      const current = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (current?.mode === 'pending' || current?.mode === 'verifying') {
        await this.rejectPendingSocket(socket, current);
      } else {
        socket.close(AUTHENTICATION_CLOSE_CODE, AUTHENTICATION_CLOSE_REASON);
      }
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.removePendingDeadline(socket);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.removePendingDeadline(socket);
  }

  async alarm(): Promise<void> {
    await this.withOperationLock(async () => {
      const now = Date.now();
      const dueWebSocketKeys = new Set(
        this.ctx.storage.sql.exec<{ deadline_key: string }>(
          `SELECT deadline_key FROM do_deadline
            WHERE deadline_kind = 'ws-auth' AND due_at_ms <= ?`,
          now,
        ).toArray().map((row) => row.deadline_key),
      );
      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
        if (
          (attachment?.mode === 'pending' || attachment?.mode === 'verifying') &&
          dueWebSocketKeys.has(pendingDeadlineKey(attachment.connectionId)) &&
          attachment.authDeadlineEpochMs <= now
        ) {
          socket.close(AUTHENTICATION_CLOSE_CODE, AUTHENTICATION_CLOSE_REASON);
        }
      }
      this.ctx.storage.sql.exec(
        `DELETE FROM do_deadline
          WHERE deadline_kind = 'ws-auth' AND due_at_ms <= ?`,
        now,
      );
      const dueReferenceWork = this.ctx.storage.sql.exec<{
        deadline_key: string;
        deadline_kind: string;
      }>(
        `SELECT deadline_key, deadline_kind FROM do_deadline
          WHERE deadline_kind IN (?, ?) AND due_at_ms <= ?
          ORDER BY due_at_ms, deadline_key
          LIMIT ?`,
        REFERENCE_CLEANUP_DEADLINE_KIND,
        TERMINAL_RELEASE_DEADLINE_KIND,
        Date.now(),
        REFERENCE_CLEANUP_BATCH_SIZE,
      ).toArray()[0];
      if (dueReferenceWork?.deadline_kind === REFERENCE_CLEANUP_DEADLINE_KIND) {
        await this.retryReferenceCleanup(dueReferenceWork.deadline_key);
      } else if (dueReferenceWork?.deadline_kind === TERMINAL_RELEASE_DEADLINE_KIND) {
        await this.retryTerminalRelease(dueReferenceWork.deadline_key);
      }
      await this.rescheduleAfterAlarm();
    });
  }

  private async rejectPendingSocket(
    socket: WebSocket,
    attachment: PendingAttachment | VerifyingAttachment,
  ): Promise<void> {
    this.ctx.storage.sql.exec(
      `DELETE FROM do_deadline WHERE deadline_key = ?`,
      pendingDeadlineKey(attachment.connectionId),
    );
    socket.close(AUTHENTICATION_CLOSE_CODE, AUTHENTICATION_CLOSE_REASON);
    await this.ensureNextAlarm();
  }

  private async removePendingDeadline(socket: WebSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
    if (attachment?.mode !== 'pending' && attachment?.mode !== 'verifying') return;
    this.ctx.storage.sql.exec(
      `DELETE FROM do_deadline WHERE deadline_key = ?`,
      pendingDeadlineKey(attachment.connectionId),
    );
    await this.ensureNextAlarm();
  }

  /** 再割当後の旧socketを即時に落とし、休止復帰後もmessageごとに正本を照合する。 */
  private closeStaleSeatConnections(
    seatId: MatchSeatId,
    currentAssignmentVersion: number,
  ): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (
        attachment?.mode === 'authenticated' &&
        attachment.seatId === seatId &&
        attachment.assignmentVersion !== currentAssignmentVersion
      ) {
        socket.close(AUTHENTICATION_CLOSE_CODE, SEAT_CLOSE_REASON);
      }
    }
  }

  private isCurrentAssignment(attachment: AuthenticatedAttachment): boolean {
    const rows = this.ctx.storage.sql.exec<{ found: number }>(
      `SELECT 1 AS found
         FROM match_seat_assignment
        WHERE seat_id = ?
          AND account_id = ?
          AND session_id = ?
          AND session_version = ?
          AND assignment_version = ?
          AND coordinator_registration_id IS NOT NULL
          AND coordinator_registration_epoch_ms IS NOT NULL`,
      attachment.seatId,
      attachment.accountId,
      attachment.sessionId,
      attachment.sessionVersion,
      attachment.assignmentVersion,
    ).toArray();
    return rows.length === 1;
  }

  private async withOperationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTail;
    let release!: () => void;
    this.operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async invalidateSessionExclusive(input: {
    sessionId: string;
    invalidatedVersion: number;
  }): Promise<{ state: 'acknowledged'; closedConnections: number }> {
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO match_session_invalidation (
           session_id, invalidated_version, invalidated_at_ms
         ) VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           invalidated_version = MAX(invalidated_version, excluded.invalidated_version),
           invalidated_at_ms = excluded.invalidated_at_ms`,
        input.sessionId,
        input.invalidatedVersion,
        now,
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM match_seat_token
          WHERE session_id = ? AND session_version < ?`,
        input.sessionId,
        input.invalidatedVersion,
      );
    });

    let closedConnections = 0;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (
        attachment &&
        attachment.mode !== 'diagnostic' &&
        attachment.sessionId === input.sessionId &&
        attachment.sessionVersion < input.invalidatedVersion
      ) {
        if (attachment.mode === 'pending' || attachment.mode === 'verifying') {
          this.ctx.storage.sql.exec(
            `DELETE FROM do_deadline WHERE deadline_key = ?`,
            pendingDeadlineKey(attachment.connectionId),
          );
        }
        socket.close(AUTHENTICATION_CLOSE_CODE, SESSION_CLOSE_REASON);
        closedConnections += 1;
      }
    }
    await this.ensureNextAlarm();
    return { state: 'acknowledged', closedConnections };
  }

  private async startNpcBattleExclusive(
    input: StartNpcBattleInput,
  ): Promise<StartNpcBattleResult> {
    const matchId = this.ctx.id.name!;
    const fixture = g1NpcBattleInput(input.seed);
    let lifecycle = this.battleLifecycleRow();
    const created = lifecycle === undefined;

    if (lifecycle) {
      if (
        lifecycle.match_id !== matchId ||
        lifecycle.seed !== input.seed ||
        !samePrincipal(lifecycle, input.principal)
      ) {
        return { state: 'conflict' };
      }
      if (
        lifecycle.lifecycle_state === 'finished' ||
        lifecycle.lifecycle_state === 'cancelled' ||
        lifecycle.lifecycle_state === 'abandoned'
      ) {
        return { state: 'conflict' };
      }
      if (lifecycle.lifecycle_state === 'active') {
        if (!this.lifecycleVersionsMatch(lifecycle, fixture.versions)) {
          return { state: 'unavailable' };
        }
        let current: BattleLifecycleRow;
        try {
          current = this.requireBattleLifecycle(input.principal, true);
        } catch (error) {
          if (
            error instanceof MatchBattleError &&
            error.code === 'MATCH_BATTLE_ACCESS_DENIED'
          ) {
            return { state: 'conflict' };
          }
          throw error;
        }
        if (!this.battleRuntime) return { state: 'unavailable' };
        const finished = this.battleRuntime.result();
        if (finished) {
          await this.persistBattleTerminal(current, this.finishedTerminalResult(finished));
          return { state: 'conflict' };
        }
        return { state: 'ready', created: false };
      }
      if (!this.lifecycleVersionsMatch(lifecycle, fixture.versions)) {
        return { state: 'unavailable' };
      }
    } else {
      const now = Date.now();
      this.ctx.storage.sql.exec(
        `INSERT INTO match_battle_lifecycle (
           lifecycle_key, match_id, lifecycle_state, account_id, session_id,
           session_version, seat_id, assignment_version, seed, adapter_version,
           engine_version, content_version, format_version_id, npc_policy_id,
           started_at_ms
         ) VALUES (1, ?, 'provisioning', ?, ?, ?, 'player-1', NULL, ?, ?, ?, ?, ?, ?, ?)`,
        matchId,
        input.principal.accountId,
        input.principal.sessionId,
        input.principal.sessionVersion,
        input.seed,
        fixture.versions.adapterVersion,
        fixture.versions.engineVersion,
        fixture.versions.contentVersion,
        fixture.versions.formatVersionId,
        fixture.versions.npcPolicyId,
        now,
      );
      lifecycle = this.battleLifecycleRow();
      if (!lifecycle) throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }

    let runtime: EngineBattleAdapter;
    try {
      runtime = EngineBattleAdapter.create(fixture);
    } catch {
      return { state: 'unavailable' };
    }

    const assignment = await this.assignSeatExclusive({
      ...input.principal,
      seatId: 'player-1',
    });
    if (assignment.state !== 'assigned') return { state: 'conflict' };

    const installed = this.ctx.storage.sql.exec<AssignmentReferenceRow>(
      `SELECT seat_id, account_id, session_id, session_version, assignment_version,
              coordinator_registration_id, coordinator_registration_epoch_ms
         FROM match_seat_assignment`,
    ).toArray();
    if (
      installed.length !== 1 ||
      installed[0]!.seat_id !== 'player-1' ||
      installed[0]!.account_id !== input.principal.accountId ||
      installed[0]!.session_id !== input.principal.sessionId ||
      installed[0]!.session_version !== input.principal.sessionVersion ||
      installed[0]!.assignment_version !== assignment.assignmentVersion
    ) {
      return { state: 'conflict' };
    }

    const activated = this.ctx.storage.sql.exec<{ lifecycle_state: string }>(
      `UPDATE match_battle_lifecycle
          SET lifecycle_state = 'active', assignment_version = ?
        WHERE lifecycle_key = 1 AND lifecycle_state = 'provisioning'
          AND match_id = ? AND account_id = ? AND session_id = ?
          AND session_version = ? AND seed = ?
        RETURNING lifecycle_state`,
      assignment.assignmentVersion,
      matchId,
      input.principal.accountId,
      input.principal.sessionId,
      input.principal.sessionVersion,
      input.seed,
    ).toArray();
    if (activated.length !== 1) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }
    this.battleRuntime = runtime;

    const immediateResult = runtime.result();
    if (immediateResult) {
      const active = this.battleLifecycleRow();
      if (!active) throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      await this.persistBattleTerminal(active, this.finishedTerminalResult(immediateResult));
    }
    return { state: 'ready', created };
  }

  private battleLifecycleRow(): BattleLifecycleRow | undefined {
    return this.ctx.storage.sql.exec<BattleLifecycleRow>(
      `SELECT match_id, lifecycle_state, account_id, session_id, session_version,
              seat_id, assignment_version, seed, adapter_version, engine_version,
              content_version, format_version_id, npc_policy_id, started_at_ms,
              terminal_at_ms, terminal_reason, winner, engine_end_reason, turns,
              final_state_hash, applied_actions
         FROM match_battle_lifecycle WHERE lifecycle_key = 1`,
    ).toArray()[0];
  }

  private lifecycleVersionsMatch(
    lifecycle: BattleLifecycleRow,
    versions: EngineBattleVersions,
  ): boolean {
    return (
      lifecycle.adapter_version === versions.adapterVersion &&
      lifecycle.engine_version === versions.engineVersion &&
      lifecycle.content_version === versions.contentVersion &&
      lifecycle.format_version_id === versions.formatVersionId &&
      lifecycle.npc_policy_id === versions.npcPolicyId
    );
  }

  private lifecycleFromRow(row: BattleLifecycleRow): NpcBattleLifecycle {
    if (
      !isLifecycleState(row.lifecycle_state) ||
      row.match_id !== this.ctx.id.name ||
      row.seat_id !== 'player-1' ||
      !UUID_PATTERN.test(row.account_id) ||
      !UUID_PATTERN.test(row.session_id) ||
      !positiveInteger(row.session_version) ||
      !validBattleSeed(row.seed) ||
      row.adapter_version !== ENGINE_BATTLE_ADAPTER_VERSION ||
      row.npc_policy_id !== G1_NPC_POLICY_ID ||
      typeof row.engine_version !== 'string' ||
      typeof row.content_version !== 'string' ||
      typeof row.format_version_id !== 'string' ||
      !positiveInteger(row.started_at_ms) ||
      (row.assignment_version !== null && !positiveInteger(row.assignment_version)) ||
      (row.lifecycle_state === 'provisioning' && row.assignment_version !== null) ||
      ((row.lifecycle_state === 'active' ||
        row.lifecycle_state === 'finished' ||
        row.lifecycle_state === 'abandoned') &&
        !positiveInteger(row.assignment_version))
    ) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }

    let terminalResult: NpcBattleTerminalResult | null = null;
    if (row.lifecycle_state === 'finished') {
      if (
        !positiveInteger(row.terminal_at_ms) ||
        row.terminal_at_ms < row.started_at_ms ||
        row.terminal_reason !== null ||
        (row.winner !== null && row.winner !== HUMAN_PLAYER && row.winner !== NPC_PLAYER) ||
        (row.engine_end_reason !== 'wipeout' &&
          row.engine_end_reason !== 'deckout' &&
          row.engine_end_reason !== 'turnLimit') ||
        !Number.isSafeInteger(row.turns) ||
        Number(row.turns) < 0 ||
        typeof row.final_state_hash !== 'string' ||
        row.final_state_hash.length === 0 ||
        !Number.isSafeInteger(row.applied_actions) ||
        Number(row.applied_actions) < 0
      ) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      terminalResult = {
        kind: 'finished',
        winner: row.winner as 0 | 1 | null,
        endReason: row.engine_end_reason,
        turns: row.turns as number,
        finalStateHash: row.final_state_hash,
        appliedActions: row.applied_actions as number,
      };
    } else if (row.lifecycle_state === 'cancelled') {
      const hasNoRuntimeResult =
        row.turns === null && row.final_state_hash === null && row.applied_actions === null;
      const hasCompleteRuntimeResult =
        Number.isSafeInteger(row.turns) &&
        Number(row.turns) >= 0 &&
        typeof row.final_state_hash === 'string' &&
        row.final_state_hash.length > 0 &&
        Number.isSafeInteger(row.applied_actions) &&
        Number(row.applied_actions) >= 0;
      if (
        !positiveInteger(row.terminal_at_ms) ||
        !isCancellationReason(row.terminal_reason) ||
        row.winner !== null ||
        row.engine_end_reason !== null ||
        (!hasNoRuntimeResult && !hasCompleteRuntimeResult) ||
        (hasNoRuntimeResult && row.assignment_version !== null) ||
        (hasCompleteRuntimeResult && !positiveInteger(row.assignment_version))
      ) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      terminalResult = {
        kind: 'cancelled',
        winner: null,
        reason: row.terminal_reason,
        turns: row.turns,
        finalStateHash: row.final_state_hash,
        appliedActions: row.applied_actions,
      };
    } else if (row.lifecycle_state === 'abandoned') {
      if (
        !positiveInteger(row.terminal_at_ms) ||
        !isAbandonReason(row.terminal_reason) ||
        row.winner !== NPC_PLAYER ||
        row.engine_end_reason !== null ||
        !Number.isSafeInteger(row.turns) ||
        Number(row.turns) < 0 ||
        typeof row.final_state_hash !== 'string' ||
        row.final_state_hash.length === 0 ||
        !Number.isSafeInteger(row.applied_actions) ||
        Number(row.applied_actions) < 0
      ) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      terminalResult = {
        kind: 'abandoned',
        winner: NPC_PLAYER,
        reason: row.terminal_reason,
        turns: row.turns as number,
        finalStateHash: row.final_state_hash,
        appliedActions: row.applied_actions as number,
      };
    } else if (
      row.terminal_at_ms !== null ||
      row.terminal_reason !== null ||
      row.winner !== null ||
      row.engine_end_reason !== null ||
      row.turns !== null ||
      row.final_state_hash !== null ||
      row.applied_actions !== null
    ) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }

    return {
      matchId: row.match_id,
      state: row.lifecycle_state,
      principal: {
        accountId: row.account_id,
        sessionId: row.session_id,
        sessionVersion: row.session_version,
      },
      seatId: 'player-1',
      assignmentVersion: row.assignment_version,
      seed: row.seed,
      versions: {
        adapterVersion: ENGINE_BATTLE_ADAPTER_VERSION,
        engineVersion: row.engine_version,
        contentVersion: row.content_version,
        formatVersionId: row.format_version_id,
        npcPolicyId: G1_NPC_POLICY_ID,
      },
      startedAtEpochMs: row.started_at_ms,
      terminalAtEpochMs: row.terminal_at_ms,
      terminalResult,
    };
  }

  private requireBattleLifecycle(
    principal: MatchSessionPrincipal,
    requireCurrentSession: boolean,
  ): BattleLifecycleRow {
    const lifecycle = this.battleLifecycleRow();
    if (!lifecycle) throw new MatchBattleError('MATCH_BATTLE_NOT_STARTED');
    this.lifecycleFromRow(lifecycle);
    if (!samePrincipal(lifecycle, principal)) {
      throw new MatchBattleError('MATCH_BATTLE_ACCESS_DENIED');
    }
    if (requireCurrentSession) {
      const invalidation = this.ctx.storage.sql.exec<{ invalidated_version: number }>(
        `SELECT invalidated_version FROM match_session_invalidation WHERE session_id = ?`,
        principal.sessionId,
      ).toArray()[0];
      if (invalidation && invalidation.invalidated_version > principal.sessionVersion) {
        throw new MatchBattleError('MATCH_BATTLE_ACCESS_DENIED');
      }
      if (lifecycle.lifecycle_state === 'active') {
        const assignment = this.ctx.storage.sql.exec<{ found: number }>(
          `SELECT 1 AS found FROM match_seat_assignment
            WHERE seat_id = 'player-1' AND account_id = ? AND session_id = ?
              AND session_version = ? AND assignment_version = ?
              AND coordinator_registration_id IS NOT NULL
              AND coordinator_registration_epoch_ms IS NOT NULL`,
          principal.accountId,
          principal.sessionId,
          principal.sessionVersion,
          lifecycle.assignment_version,
        ).toArray();
        if (assignment.length !== 1) {
          throw new MatchBattleError('MATCH_BATTLE_ACCESS_DENIED');
        }
      }
    }
    return lifecycle;
  }

  private requireBattleRuntime(): EngineBattleAdapter {
    if (!this.battleRuntime) throw new MatchBattleError('MATCH_STATE_UNAVAILABLE');
    return this.battleRuntime;
  }

  private finishedTerminalResult(result: NpcBattleResult): NpcBattleTerminalResult {
    return {
      kind: 'finished',
      winner: result.winner,
      endReason: result.endReason,
      turns: result.turns,
      finalStateHash: result.finalStateHash,
      appliedActions: result.appliedActions,
    };
  }

  private async reconcileFinishedRuntime(
    lifecycle: BattleLifecycleRow,
  ): Promise<BattleLifecycleRow> {
    if (lifecycle.lifecycle_state !== 'active' || !this.battleRuntime) return lifecycle;
    const result = this.battleRuntime.result();
    return result
      ? this.persistBattleTerminal(lifecycle, this.finishedTerminalResult(result))
      : lifecycle;
  }

  /** lifecycle/outbox/token/assignment/alarmを先にatomic commitし、その後だけ外部解除する。 */
  private async persistBattleTerminal(
    lifecycle: BattleLifecycleRow,
    terminal: NpcBattleTerminalResult,
  ): Promise<BattleLifecycleRow> {
    if (
      lifecycle.lifecycle_state !== 'provisioning' &&
      lifecycle.lifecycle_state !== 'active'
    ) {
      throw new MatchBattleError('MATCH_BATTLE_ALREADY_TERMINAL');
    }
    const matchId = this.ctx.id.name;
    if (!matchId || lifecycle.match_id !== matchId || !validBattleSeed(lifecycle.seed)) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }

    const assignments = this.ctx.storage.sql.exec<AssignmentReferenceRow>(
      `SELECT seat_id, account_id, session_id, session_version, assignment_version,
              coordinator_registration_id, coordinator_registration_epoch_ms
         FROM match_seat_assignment ORDER BY seat_id`,
    ).toArray();
    if (
      (lifecycle.lifecycle_state === 'active' && assignments.length !== 1) ||
      assignments.length > 1
    ) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }
    for (const assignment of assignments) {
      if (
        assignment.seat_id !== 'player-1' ||
        assignment.account_id !== lifecycle.account_id ||
        assignment.session_id !== lifecycle.session_id ||
        assignment.session_version !== lifecycle.session_version ||
        (lifecycle.assignment_version !== null &&
          assignment.assignment_version !== lifecycle.assignment_version) ||
        typeof assignment.coordinator_registration_id !== 'string' ||
        !UUID_PATTERN.test(assignment.coordinator_registration_id) ||
        !positiveInteger(assignment.coordinator_registration_epoch_ms)
      ) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
    }

    const terminalAtEpochMs = Math.max(Date.now(), lifecycle.started_at_ms);
    const terminalState = terminal.kind;
    const terminalReason = terminal.kind === 'finished' ? null : terminal.reason;
    const engineEndReason = terminal.kind === 'finished' ? terminal.endReason : null;
    const assignmentVersion = assignments[0]?.assignment_version ?? lifecycle.assignment_version;
    const dueAtEpochMs = Date.now() + REFERENCE_CLEANUP_RETRY_BASE_MS;
    const releases: TerminalReleaseRow[] = assignments.map((assignment) => ({
      registration_id: assignment.coordinator_registration_id!,
      registration_epoch_ms: assignment.coordinator_registration_epoch_ms!,
      seat_id: assignment.seat_id,
      account_id: assignment.account_id,
      session_id: assignment.session_id,
      session_version: assignment.session_version,
      match_id: matchId,
      seed: lifecycle.seed,
      release_phase: TERMINAL_RELEASE_PHASE_UNREGISTER,
      retry_attempt: 0,
    }));
    if (releases.length === 0) {
      releases.push({
        registration_id: crypto.randomUUID(),
        registration_epoch_ms: this.nextReferenceEpoch(),
        seat_id: 'player-1',
        account_id: lifecycle.account_id,
        session_id: lifecycle.session_id,
        session_version: lifecycle.session_version,
        match_id: matchId,
        seed: lifecycle.seed,
        release_phase: TERMINAL_RELEASE_PHASE_RESERVATION,
        retry_attempt: 0,
      });
    }

    await this.ctx.storage.transaction(async (transaction) => {
      const updated = this.ctx.storage.sql.exec<{ lifecycle_state: string }>(
        `UPDATE match_battle_lifecycle
            SET lifecycle_state = ?, assignment_version = ?, terminal_at_ms = ?,
                terminal_reason = ?, winner = ?, engine_end_reason = ?, turns = ?,
                final_state_hash = ?, applied_actions = ?
          WHERE lifecycle_key = 1 AND lifecycle_state = ?
            AND match_id = ? AND account_id = ? AND session_id = ?
            AND session_version = ? AND seed = ?
          RETURNING lifecycle_state`,
        terminalState,
        assignmentVersion,
        terminalAtEpochMs,
        terminalReason,
        terminal.winner,
        engineEndReason,
        terminal.turns,
        terminal.finalStateHash,
        terminal.appliedActions,
        lifecycle.lifecycle_state,
        matchId,
        lifecycle.account_id,
        lifecycle.session_id,
        lifecycle.session_version,
        lifecycle.seed,
      ).toArray();
      if (updated.length !== 1) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }

      for (const release of releases) {
        this.ctx.storage.sql.exec(
          `INSERT INTO match_terminal_release (
             seat_id, registration_id, registration_epoch_ms, account_id,
             session_id, session_version, match_id, seed, release_phase, retry_attempt
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          release.seat_id,
          release.registration_id,
          release.registration_epoch_ms,
          release.account_id,
          release.session_id,
          release.session_version,
          matchId,
          lifecycle.seed,
          release.release_phase,
        );
        this.upsertTerminalReleaseDeadline(release.registration_id, dueAtEpochMs);
      }
      this.ctx.storage.sql.exec(`DELETE FROM match_seat_token`);
      this.ctx.storage.sql.exec(`DELETE FROM match_seat_assignment`);
      this.ctx.storage.sql.exec(`DELETE FROM do_deadline WHERE deadline_kind = 'ws-auth'`);
      await this.ensureNextAlarmInTransaction(transaction);
    });

    this.closeTerminalConnections();
    this.battleRuntime = null;
    for (const release of releases) {
      await this.retryTerminalRelease(terminalReleaseDeadlineKey(release.registration_id));
    }
    const stored = this.battleLifecycleRow();
    if (!stored) throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    return stored;
  }

  private closeTerminalConnections(): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (attachment?.mode !== 'diagnostic') {
        socket.close(MATCH_TERMINAL_CLOSE_CODE, MATCH_TERMINAL_CLOSE_REASON);
      }
    }
  }

  private upsertTerminalReleaseDeadline(
    registrationId: string,
    dueAtEpochMs: number,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO do_deadline (deadline_key, deadline_kind, due_at_ms)
       VALUES (?, ?, ?)
       ON CONFLICT(deadline_key) DO UPDATE SET
         deadline_kind = excluded.deadline_kind,
         due_at_ms = MIN(do_deadline.due_at_ms, excluded.due_at_ms)`,
      terminalReleaseDeadlineKey(registrationId),
      TERMINAL_RELEASE_DEADLINE_KIND,
      dueAtEpochMs,
    );
  }

  private terminalReleaseForDeadline(deadlineKey: string): TerminalReleaseRow | undefined {
    return this.ctx.storage.sql.exec<TerminalReleaseRow>(
      `SELECT registration_id, registration_epoch_ms, seat_id, account_id,
              session_id, session_version, match_id, seed, release_phase, retry_attempt
         FROM match_terminal_release
        WHERE ? = 'coordinator-terminal-release:' || registration_id`,
      deadlineKey,
    ).toArray()[0];
  }

  private validateTerminalRelease(row: TerminalReleaseRow): void {
    if (
      !UUID_PATTERN.test(row.registration_id) ||
      !positiveInteger(row.registration_epoch_ms) ||
      !isSeatId(row.seat_id) ||
      !UUID_PATTERN.test(row.account_id) ||
      !UUID_PATTERN.test(row.session_id) ||
      !positiveInteger(row.session_version) ||
      !NPC_MATCH_ID_PATTERN.test(row.match_id) ||
      !validBattleSeed(row.seed) ||
      (row.release_phase !== TERMINAL_RELEASE_PHASE_UNREGISTER &&
        row.release_phase !== TERMINAL_RELEASE_PHASE_RESERVATION) ||
      !Number.isSafeInteger(row.retry_attempt) ||
      row.retry_attempt < 0
    ) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }
  }

  private async retryTerminalRelease(
    deadlineKey: string,
    coordinatorOverride?: NpcReservationReleasePort,
  ): Promise<boolean> {
    let release = this.terminalReleaseForDeadline(deadlineKey);
    if (!release) {
      this.ctx.storage.sql.exec(
        `DELETE FROM do_deadline WHERE deadline_key = ?`,
        deadlineKey,
      );
      return true;
    }
    this.validateTerminalRelease(release);
    const coordinator = coordinatorOverride ?? sessionCoordinatorStub(
      this.env,
      release.session_id,
    ) as NpcReservationReleasePort;

    if (release.release_phase === TERMINAL_RELEASE_PHASE_UNREGISTER) {
      try {
        const result = await coordinator.unregisterMatch({
          sessionId: release.session_id,
          sessionVersion: release.session_version,
          matchId: release.match_id,
          registrationId: release.registration_id,
          registrationEpochMs: release.registration_epoch_ms,
        });
        if (
          !plainObject(result) ||
          !hasExactKeys(result, ['state']) ||
          result.state !== 'acknowledged'
        ) {
          throw new Error('MATCH_REFERENCE_RELEASE_REJECTED');
        }
      } catch {
        await this.scheduleTerminalReleaseRetry(release);
        return false;
      }

      await this.ctx.storage.transaction(async (transaction) => {
        const changed = this.ctx.storage.sql.exec<{ release_phase: string }>(
          `UPDATE match_terminal_release
              SET release_phase = ?, retry_attempt = 0
            WHERE registration_id = ? AND release_phase = ?
            RETURNING release_phase`,
          TERMINAL_RELEASE_PHASE_RESERVATION,
          release!.registration_id,
          TERMINAL_RELEASE_PHASE_UNREGISTER,
        ).toArray();
        if (changed.length !== 1) {
          throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
        }
        this.ctx.storage.sql.exec(
          `UPDATE do_deadline SET due_at_ms = ? WHERE deadline_key = ?`,
          Date.now(),
          deadlineKey,
        );
        await this.ensureNextAlarmInTransaction(transaction);
      });
      release = this.terminalReleaseForDeadline(deadlineKey);
      if (!release) throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      this.validateTerminalRelease(release);
    }

    try {
      const result = await coordinator.releaseNpcMatch({
        sessionId: release.session_id,
        accountId: release.account_id,
        sessionVersion: release.session_version,
        matchId: release.match_id,
        seed: release.seed,
      });
      if (!plainObject(result) || !hasExactKeys(result, ['state'])) {
        throw new Error('MATCH_RESERVATION_RELEASE_REJECTED');
      }
      if (result.state === 'references_remain') {
        await this.scheduleTerminalReleaseRetry(release);
        return false;
      }
      if (
        result.state !== 'released' &&
        result.state !== 'missing' &&
        result.state !== 'conflict'
      ) {
        throw new Error('MATCH_RESERVATION_RELEASE_REJECTED');
      }
      this.clearTerminalRelease(release.registration_id);
      return true;
    } catch {
      await this.scheduleTerminalReleaseRetry(release);
      return false;
    }
  }

  private async scheduleTerminalReleaseRetry(release: TerminalReleaseRow): Promise<void> {
    const retryAttempt = release.retry_attempt + 1;
    const dueAtEpochMs = Date.now() + referenceCleanupRetryDelayMs(retryAttempt);
    await this.ctx.storage.transaction(async (transaction) => {
      const changed = this.ctx.storage.sql.exec<{ registration_id: string }>(
        `UPDATE match_terminal_release
            SET retry_attempt = ?
          WHERE registration_id = ? AND release_phase = ?
          RETURNING registration_id`,
        retryAttempt,
        release.registration_id,
        release.release_phase,
      ).toArray();
      if (changed.length !== 1) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      this.ctx.storage.sql.exec(
        `UPDATE do_deadline SET due_at_ms = ? WHERE deadline_key = ?`,
        dueAtEpochMs,
        terminalReleaseDeadlineKey(release.registration_id),
      );
      await this.ensureNextAlarmInTransaction(transaction);
    });
  }

  private clearTerminalRelease(registrationId: string): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `DELETE FROM match_terminal_release WHERE registration_id = ?`,
        registrationId,
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM do_deadline WHERE deadline_key = ?`,
        terminalReleaseDeadlineKey(registrationId),
      );
    });
  }

  private hasLocalAssignmentConflict(
    input: MatchSessionPrincipal & { seatId: MatchSeatId },
  ): boolean {
    const invalidation = this.ctx.storage.sql.exec<{ invalidated_version: number }>(
      `SELECT invalidated_version FROM match_session_invalidation WHERE session_id = ?`,
      input.sessionId,
    ).toArray()[0];
    if (invalidation && invalidation.invalidated_version > input.sessionVersion) return true;
    const duplicate = this.ctx.storage.sql.exec<{ found: number }>(
      `SELECT 1 AS found FROM match_seat_assignment
        WHERE (account_id = ? OR session_id = ?) AND seat_id <> ?
        LIMIT 1`,
      input.accountId,
      input.sessionId,
      input.seatId,
    ).toArray();
    if (duplicate.length > 0) return true;
    const current = this.ctx.storage.sql.exec<AssignmentRow>(
      `SELECT seat_id, account_id, session_id, session_version, assignment_version
         FROM match_seat_assignment WHERE seat_id = ?`,
      input.seatId,
    ).toArray()[0];
    return Boolean(
      (current?.session_id === input.sessionId && current.account_id !== input.accountId) ||
      (current?.session_id === input.sessionId &&
        current.account_id === input.accountId &&
        current.session_version > input.sessionVersion),
    );
  }

  private referenceWorkForSeat(seatId: MatchSeatId): ReferenceCleanupRow | undefined {
    return this.ctx.storage.sql.exec<ReferenceCleanupRow>(
      `SELECT registration_id, registration_epoch_ms, seat_id, account_id,
              session_id, session_version,
              match_id, work_kind, retry_attempt
         FROM match_reference_cleanup WHERE seat_id = ?`,
      seatId,
    ).toArray()[0];
  }

  private referenceWorkFromRow(row: ReferenceCleanupRow): MatchReferenceWork {
    if (!isSeatId(row.seat_id)) throw new TypeError('MATCH_REFERENCE_WORK_INVALID');
    return {
      seatId: row.seat_id,
      accountId: row.account_id,
      sessionId: row.session_id,
      sessionVersion: row.session_version,
      matchId: row.match_id,
      registrationId: row.registration_id,
      registrationEpochMs: row.registration_epoch_ms,
    };
  }

  private nextReferenceEpoch(): number {
    return this.ctx.storage.transactionSync(() => {
      const stored = this.ctx.storage.sql.exec<{ last_epoch_ms: number }>(
        `SELECT last_epoch_ms FROM match_reference_clock WHERE clock_key = 1`,
      ).toArray()[0]?.last_epoch_ms ?? 0;
      const next = Math.max(Date.now(), stored + 1);
      this.ctx.storage.sql.exec(
        `INSERT INTO match_reference_clock (clock_key, last_epoch_ms) VALUES (1, ?)
         ON CONFLICT(clock_key) DO UPDATE SET last_epoch_ms = excluded.last_epoch_ms`,
        next,
      );
      return next;
    });
  }

  private advanceReferenceEpoch(cancelledThroughEpochMs: number): void {
    if (!positiveInteger(cancelledThroughEpochMs)) {
      throw new TypeError('MATCH_REFERENCE_EPOCH_INVALID');
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO match_reference_clock (clock_key, last_epoch_ms) VALUES (1, ?)
       ON CONFLICT(clock_key) DO UPDATE SET
         last_epoch_ms = MAX(last_epoch_ms, excluded.last_epoch_ms)`,
      cancelledThroughEpochMs,
    );
  }

  private assignmentOwnsReference(reference: MatchReferenceWork): boolean {
    return this.ctx.storage.sql.exec<{ found: number }>(
      `SELECT 1 AS found FROM match_seat_assignment
        WHERE seat_id = ? AND account_id = ? AND session_id = ?
          AND session_version = ? AND coordinator_registration_id = ?
          AND coordinator_registration_epoch_ms = ?`,
      reference.seatId,
      reference.accountId,
      reference.sessionId,
      reference.sessionVersion,
      reference.registrationId,
      reference.registrationEpochMs,
    ).toArray().length === 1;
  }

  private async persistPendingReference(reference: MatchReferenceWork): Promise<void> {
    const dueAtEpochMs = Date.now() + REFERENCE_CLEANUP_RETRY_BASE_MS;
    await this.ctx.storage.transaction(async (transaction) => {
      this.ctx.storage.sql.exec(
        `INSERT INTO match_reference_cleanup (
           registration_id, registration_epoch_ms, seat_id, account_id,
           session_id, session_version,
           match_id, work_kind, retry_attempt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_assignment', 0)`,
        reference.registrationId,
        reference.registrationEpochMs,
        reference.seatId,
        reference.accountId,
        reference.sessionId,
        reference.sessionVersion,
        reference.matchId,
      );
      this.upsertReferenceDeadline(reference.registrationId, dueAtEpochMs);
      await this.ensureNextAlarmInTransaction(transaction);
    });
  }

  private async commitReferenceInstallation(
    transaction: DurableObjectTransaction,
    installed: MatchReferenceWork,
    displaced: MatchReferenceWork | null,
  ): Promise<void> {
    this.ctx.storage.sql.exec(
      `DELETE FROM match_reference_cleanup WHERE registration_id = ?`,
      installed.registrationId,
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM do_deadline WHERE deadline_key = ?`,
      referenceCleanupDeadlineKey(installed.registrationId),
    );
    if (displaced) {
      this.ctx.storage.sql.exec(
        `INSERT INTO match_reference_cleanup (
           registration_id, registration_epoch_ms, seat_id, account_id,
           session_id, session_version,
           match_id, work_kind, retry_attempt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'cleanup', 0)`,
        displaced.registrationId,
        displaced.registrationEpochMs,
        displaced.seatId,
        displaced.accountId,
        displaced.sessionId,
        displaced.sessionVersion,
        displaced.matchId,
      );
      this.upsertReferenceDeadline(
        displaced.registrationId,
        Date.now() + REFERENCE_CLEANUP_RETRY_BASE_MS,
      );
    }
    await this.ensureNextAlarmInTransaction(transaction);
  }

  private upsertReferenceDeadline(registrationId: string, dueAtEpochMs: number): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO do_deadline (deadline_key, deadline_kind, due_at_ms)
       VALUES (?, ?, ?)
       ON CONFLICT(deadline_key) DO UPDATE SET
         deadline_kind = excluded.deadline_kind,
         due_at_ms = MIN(do_deadline.due_at_ms, excluded.due_at_ms)`,
      referenceCleanupDeadlineKey(registrationId),
      REFERENCE_CLEANUP_DEADLINE_KIND,
      dueAtEpochMs,
    );
  }

  private async unregisterReference(
    reference: MatchReferenceWork,
    coordinator?: SessionCoordinatorPort,
  ): Promise<void> {
    try {
      const target = coordinator ?? sessionCoordinatorStub(this.env, reference.sessionId);
      await target.unregisterMatch({
        sessionId: reference.sessionId,
        sessionVersion: reference.sessionVersion,
        matchId: reference.matchId,
        registrationId: reference.registrationId,
        registrationEpochMs: reference.registrationEpochMs,
      });
      this.clearReferenceCleanup(reference.registrationId);
    } catch {
      await this.scheduleReferenceCleanup(reference);
    }
  }

  private clearReferenceCleanup(registrationId: string): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `DELETE FROM match_reference_cleanup WHERE registration_id = ?`,
        registrationId,
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM do_deadline WHERE deadline_key = ?`,
        referenceCleanupDeadlineKey(registrationId),
      );
    });
  }

  private async scheduleReferenceCleanup(reference: MatchReferenceWork): Promise<void> {
    const dueAtEpochMs = Date.now() + REFERENCE_CLEANUP_RETRY_BASE_MS;
    await this.ctx.storage.transaction(async (transaction) => {
      this.ctx.storage.sql.exec(
        `INSERT INTO match_reference_cleanup (
           registration_id, registration_epoch_ms, seat_id, account_id,
           session_id, session_version,
           match_id, work_kind, retry_attempt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'cleanup', 0)
         ON CONFLICT(registration_id) DO UPDATE SET
           registration_epoch_ms = excluded.registration_epoch_ms,
           seat_id = excluded.seat_id,
           account_id = excluded.account_id,
           session_id = excluded.session_id,
           session_version = excluded.session_version,
           match_id = excluded.match_id,
           work_kind = 'cleanup'`,
        reference.registrationId,
        reference.registrationEpochMs,
        reference.seatId,
        reference.accountId,
        reference.sessionId,
        reference.sessionVersion,
        reference.matchId,
      );
      this.upsertReferenceDeadline(reference.registrationId, dueAtEpochMs);
      await this.ensureNextAlarmInTransaction(transaction);
    });
  }

  private async retryReferenceCleanup(deadlineKey: string): Promise<boolean> {
    const cleanup = this.ctx.storage.sql.exec<ReferenceCleanupRow>(
      `SELECT registration_id, registration_epoch_ms, seat_id, account_id,
              session_id, session_version,
              match_id, work_kind, retry_attempt
         FROM match_reference_cleanup
        WHERE ? = 'coordinator-cleanup:' || registration_id`,
      deadlineKey,
    ).toArray()[0];
    if (!cleanup) {
      this.ctx.storage.sql.exec(
        `DELETE FROM do_deadline WHERE deadline_key = ?`,
        deadlineKey,
      );
      return true;
    }
    try {
      const coordinator = sessionCoordinatorStub(this.env, cleanup.session_id);
      await coordinator.unregisterMatch({
        sessionId: cleanup.session_id,
        sessionVersion: cleanup.session_version,
        matchId: cleanup.match_id,
        registrationId: cleanup.registration_id,
        registrationEpochMs: cleanup.registration_epoch_ms,
      });
      this.clearReferenceCleanup(cleanup.registration_id);
      return true;
    } catch {
      const retryAttempt = cleanup.retry_attempt + 1;
      const dueAtEpochMs = Date.now() + referenceCleanupRetryDelayMs(retryAttempt);
      await this.ctx.storage.transaction(async (transaction) => {
        this.ctx.storage.sql.exec(
          `UPDATE match_reference_cleanup
              SET retry_attempt = ?
            WHERE registration_id = ?`,
          retryAttempt,
          cleanup.registration_id,
        );
        this.ctx.storage.sql.exec(
          `UPDATE do_deadline SET due_at_ms = ? WHERE deadline_key = ?`,
          dueAtEpochMs,
          deadlineKey,
        );
        await this.ensureNextAlarmInTransaction(transaction);
      });
      return false;
    }
  }

  /** SQLite deadlineとruntime alarmを同一storage transactionで確定する。 */
  private async ensureNextAlarmInTransaction(
    transaction: DurableObjectTransaction,
  ): Promise<void> {
    const next = this.ctx.storage.sql.exec<{ due_at_ms: number | null }>(
      `SELECT MIN(due_at_ms) AS due_at_ms FROM do_deadline`,
    ).toArray()[0];
    if (!next || next.due_at_ms === null) return;
    const current = await transaction.getAlarm();
    if (current === null || next.due_at_ms < current) {
      await transaction.setAlarm(next.due_at_ms);
    }
  }

  /** 通常eventでは既存alarmを後ろへ動かさない。早く鳴るstale alarmは安全側。 */
  private async ensureNextAlarm(): Promise<void> {
    const next = this.ctx.storage.sql.exec<{ due_at_ms: number | null }>(
      `SELECT MIN(due_at_ms) AS due_at_ms FROM do_deadline`,
    ).toArray()[0];
    if (!next || next.due_at_ms === null) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || next.due_at_ms < current) {
      await this.ctx.storage.setAlarm(next.due_at_ms);
    }
  }

  /** alarm実行後だけ、処理済みdeadlineを除いた次の最小時刻へ付け替える。 */
  private async rescheduleAfterAlarm(): Promise<void> {
    const next = this.ctx.storage.sql.exec<{ due_at_ms: number | null }>(
      `SELECT MIN(due_at_ms) AS due_at_ms FROM do_deadline`,
    ).toArray()[0];
    if (!next || next.due_at_ms === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(next.due_at_ms);
  }
}
