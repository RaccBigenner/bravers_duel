import { DurableObject } from 'cloudflare:workers';
import {
  MATCH_ID_PATTERN,
  MATCH_PLAYER_PROJECTION_VERSION,
  MATCH_VIEWER_EVENT_VERSION,
  MAX_MATCH_VIEWER_DELTA_BATCHES,
  MAX_MATCH_REVISION,
  parseMatchAction,
  parseMatchCommandCandidate,
  parseMatchCommandId,
  parseMatchCommandResult,
  parseMatchId,
  parseMatchRevision,
  type MatchCommandCandidate,
  type MatchCommandId,
  type MatchCommandResult,
  type MatchPlayerProjection,
  type MatchRevision,
  type MatchServerFrame,
  type MatchTerminalProjection,
  type MatchViewerEventBatch,
  type MatchViewerSeat,
  type MatchViewerSync,
} from '@bravers/protocol';
import { createSessionRuntimeConfig } from '../auth/sessionRuntimeConfig';
import type { TokenDigestCandidate } from '../auth/sessionCrypto';
import {
  EngineBattleAdapter,
  EngineBattleAdapterError,
  ENGINE_BATTLE_ADAPTER_VERSION,
  G1_NPC_POLICY_ID,
  HUMAN_PLAYER,
  NPC_PLAYER,
  canonicalBattlePersistenceJson,
  createPlayerBattleProjection,
  g1NpcBattleInput,
  type AppliedBattleStep,
  type AuthoritativeBattleCheckpoint,
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
  MatchCommandLedger,
  MatchCommandLedgerError,
  MatchCommandPayloadError,
  identifyMatchCommandPayload,
  validateStoredMatchCommandPayloadIdentity,
  MAX_MATCH_COMMAND_RECORDS,
  MAX_MATCH_COMMAND_REJECTION_RECORDS,
  type MatchCommandPayloadIdentity,
} from './matchCommandLedger';
import {
  MatchWireFrameError,
  parseMatchCommandWebSocketFrame,
  serializeMatchServerFrame,
} from './matchWire';
import {
  generateSeatToken,
  parseSeatAuthFrame,
  seatTokenDigestCandidates,
  seatTokenDigestHex,
} from './seatToken';
import {
  ViewerEventProjectionError,
  createMatchViewerEventBatch,
} from './viewerEventProjection';

const MATCH_PATH = /^\/matches\/([A-Za-z0-9_-]{1,64})\/ws$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const PROBE_PREFIX = 'probe:';
const AUTHENTICATION_CLOSE_CODE = 1008;
const AUTHENTICATION_CLOSE_REASON = 'AUTH_FAILED';
const SESSION_CLOSE_REASON = 'SESSION_ENDED';
const SEAT_CLOSE_REASON = 'SEAT_REASSIGNED';
const MATCH_FRAME_TOO_LARGE_CLOSE_CODE = 1009;
const MATCH_FRAME_TOO_LARGE_CLOSE_REASON = 'MATCH_FRAME_TOO_LARGE';
const MATCH_FRAME_INVALID_CLOSE_REASON = 'MATCH_FRAME_INVALID';
const MATCH_UNAVAILABLE_CLOSE_CODE = 1011;
const MATCH_UNAVAILABLE_CLOSE_REASON = 'MATCH_UNAVAILABLE';
const MATCH_ENDED_CLOSE_CODE = 1000;
const MATCH_ENDED_CLOSE_REASON = 'MATCH_ENDED';
const REFERENCE_CLEANUP_DEADLINE_KIND = 'coordinator-cleanup';
const REFERENCE_CLEANUP_RETRY_BASE_MS = 1_000;
const REFERENCE_CLEANUP_RETRY_MAX_MS = 60_000;
const REFERENCE_CLEANUP_BATCH_SIZE = 1;
const TERMINAL_RELEASE_DEADLINE_KIND = 'coordinator-terminal-release';
const TERMINAL_RELEASE_PHASE_UNREGISTER = 'unregister_pending';
const TERMINAL_RELEASE_PHASE_RESERVATION = 'reservation_release_pending';
export const NPC_MATCH_ID_PATTERN = /^npc-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BATTLE_PERSISTENCE_VERSION = 1;
// v1 hydrateは改変検知のため全stable stepを再演する。周期checkpoint版までのDO CPU/RAM防御上限。
const MAX_PERSISTED_BATTLE_STEPS = 4_096;
const MAX_PERSISTED_BATTLE_EVENTS = 32_768;
const MAX_PERSISTED_BATTLE_HISTORY_BYTES = 16 * 1024 * 1024;
const MAX_PERSISTED_HEADER_BYTES = 128 * 1024;
const MAX_PERSISTED_INITIAL_CARDS_BYTES = 512 * 1024;
const MAX_PERSISTED_STATE_BYTES = 1024 * 1024;
const MAX_PERSISTED_BATTLE_CARDS_BYTES = 512 * 1024;
const MAX_PERSISTED_STEP_BYTES = 32 * 1024;
const MAX_PERSISTED_EVENT_BYTES = 8 * 1024;
const MAX_PERSISTED_RECEIPT_BYTES = 2 * 1024;
export const MAX_MATCH_RESUME_EVENT_BATCHES = MAX_MATCH_VIEWER_DELTA_BATCHES;
const STATE_HASH_PATTERN = /^[0-9a-f]{16}$/;
const IDENTITY_HASH_PATTERN = /^i1-[0-9a-f]{16}$/;

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

export interface ApplyNpcBattleCommandInput {
  principal: MatchSessionPrincipal;
  command: unknown;
}

export type NpcBattleRecoveryStatus = {
  state: 'provisioning' | 'active' | 'terminal';
  matchId: string;
};

export interface GetNpcBattleReceiptInput {
  principal: MatchSessionPrincipal;
  commandId: unknown;
}

type AcceptedMatchCommandResult = Extract<MatchCommandResult, { state: 'accepted' }>;
type RejectedMatchCommandResult = Extract<MatchCommandResult, { state: 'rejected' }>;
type RevisionMismatchCommandResult = Extract<
  RejectedMatchCommandResult,
  { errorCode: 'MATCH_REVISION_MISMATCH' }
>;
type ActionOrTerminalCommandResult = Extract<
  RejectedMatchCommandResult,
  { errorCode: 'MATCH_ACTION_INVALID' | 'MATCH_ALREADY_TERMINAL' }
>;
type CommandIdConflictResult = Extract<
  RejectedMatchCommandResult,
  { errorCode: 'MATCH_COMMAND_ID_CONFLICT' }
>;
type StoredMatchCommandResult =
  | AcceptedMatchCommandResult
  | RevisionMismatchCommandResult
  | ActionOrTerminalCommandResult;

/** browserへ返してよいACKだけ。authoritative transitionはOLG-124 projection経由に限定する。 */
export type ApplyNpcBattleCommandResult = MatchCommandResult;

export type MatchBattleErrorCode =
  | 'MATCH_BATTLE_INPUT_INVALID'
  | 'MATCH_BATTLE_NOT_STARTED'
  | 'MATCH_BATTLE_ACCESS_DENIED'
  | 'MATCH_BATTLE_ALREADY_TERMINAL'
  | 'MATCH_BATTLE_PERSISTENCE_INVALID'
  | 'MATCH_BATTLE_STATE_INVALID'
  | 'MATCH_COMMAND_CAPACITY_EXCEEDED'
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
  projectionVersion: typeof MATCH_PLAYER_PROJECTION_VERSION;
  viewerEventVersion: typeof MATCH_VIEWER_EVENT_VERSION;
  viewerEventSequence: number;
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
  persistence_version: number | null;
}

interface BattleManifestRow {
  [key: string]: string | number;
  match_id: string;
  schema_version: number;
  header_json: string;
  initial_battle_cards_json: string;
  initial_identity_hash: string;
  initial_event_count: number;
  created_at_ms: number;
}

interface BattleStateRow {
  [key: string]: string | number;
  match_id: string;
  revision: number;
  step_count: number;
  event_count: number;
  command_count: number;
  rejection_count: number;
  state_json: string;
  battle_cards_json: string;
  current_state_hash: string;
  current_identity_hash: string;
  updated_at_ms: number;
}

interface BattleCommandRow {
  [key: string]: string | number;
  record_sequence: number;
  command_id: string;
  match_id: string;
  seat_id: string;
  expected_revision: number;
  canonical_payload: string;
  payload_digest: string;
  result_state: string;
  result_revision: number;
  receipt_json: string;
  terminal_flag: number;
  created_at_ms: number;
}

interface BattleStepRow {
  [key: string]: string | number | null;
  step_sequence: number;
  command_id: string | null;
  command_revision: number;
  player: number;
  source: string;
  step_json: string;
  state_hash: string;
  identity_hash: string;
  event_start_sequence: number;
  event_count: number;
}

interface BattleEventRow {
  [key: string]: string | number;
  event_sequence: number;
  step_sequence: number;
  ordinal: number;
  event_json: string;
}

interface BattlePersistenceCounts {
  [key: string]: number;
  manifests: number;
  states: number;
  commands: number;
  steps: number;
  events: number;
}

interface PersistedBattleStepValue extends Omit<AppliedBattleStep, 'events'> {}

interface PreparedBattleStepInsert {
  step: AppliedBattleStep;
  commandId: MatchCommandId | null;
  commandRevision: MatchRevision;
  stepJson: string;
  eventStartSequence: number;
  eventJson: string[];
}

interface PreparedBattleRuntimePersistence {
  checkpoint: AuthoritativeBattleCheckpoint;
  stateJson: string;
  battleCardsJson: string;
  steps: PreparedBattleStepInsert[];
  nextEventCount: number;
  encodedBytes: number;
}

interface PreparedBattleTerminal {
  lifecycle: BattleLifecycleRow;
  terminal: NpcBattleTerminalResult;
  terminalAtEpochMs: number;
  assignmentVersion: number | null;
  dueAtEpochMs: number;
  releases: TerminalReleaseRow[];
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

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function jsonBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function encodePersistedJson(value: unknown, maxBytes: number): string {
  const encoded = canonicalBattlePersistenceJson(value);
  if (encoded.length === 0 || jsonBytes(encoded) > maxBytes) {
    throw new MatchBattleError('MATCH_COMMAND_CAPACITY_EXCEEDED');
  }
  return encoded;
}

function decodePersistedJson(encoded: unknown, maxBytes: number): unknown {
  if (
    typeof encoded !== 'string' ||
    encoded.length === 0 ||
    jsonBytes(encoded) > maxBytes
  ) {
    throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(encoded);
  } catch {
    throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
  }
  if (canonicalBattlePersistenceJson(decoded) !== encoded) {
    throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
  }
  return decoded;
}

function isStoredMatchCommandResult(
  result: MatchCommandResult,
): result is StoredMatchCommandResult {
  return !(
    result.state === 'rejected' &&
    result.errorCode === 'MATCH_COMMAND_ID_CONFLICT'
  );
}

function persistedBattleStepValue(step: AppliedBattleStep): PersistedBattleStepValue {
  return {
    sequence: step.sequence,
    player: step.player,
    source: step.source,
    action: structuredClone(step.action),
    stateHash: step.stateHash,
    identityHash: step.identityHash,
  };
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

function validateApplyNpcBattleCommandInput(
  value: unknown,
): asserts value is ApplyNpcBattleCommandInput {
  if (
    !plainObject(value) ||
    !hasExactKeys(value, ['principal', 'command']) ||
    !isExactPrincipal(value.principal)
  ) {
    throw new MatchBattleError('MATCH_BATTLE_INPUT_INVALID');
  }
}

function validateGetNpcBattleReceiptInput(
  value: unknown,
): asserts value is GetNpcBattleReceiptInput {
  if (
    !plainObject(value) ||
    !hasExactKeys(value, ['principal', 'commandId']) ||
    !isExactPrincipal(value.principal) ||
    !parseMatchCommandId(value.commandId)
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

function isExactAuthenticatedAttachment(value: unknown): value is AuthenticatedAttachment {
  return (
    plainObject(value) &&
    hasExactKeys(value, [
      'mode',
      'matchId',
      'connectionId',
      'accountId',
      'sessionId',
      'sessionVersion',
      'seatId',
      'assignmentVersion',
      'projectionVersion',
      'viewerEventVersion',
      'viewerEventSequence',
    ]) &&
    value.mode === 'authenticated' &&
    typeof value.matchId === 'string' &&
    MATCH_ID_PATTERN.test(value.matchId) &&
    typeof value.connectionId === 'string' &&
    UUID_PATTERN.test(value.connectionId) &&
    typeof value.accountId === 'string' &&
    typeof value.sessionId === 'string' &&
    isPrincipal(value as unknown as MatchSessionPrincipal) &&
    isSeatId(value.seatId) &&
    positiveInteger(value.assignmentVersion) &&
    value.projectionVersion === MATCH_PLAYER_PROJECTION_VERSION &&
    value.viewerEventVersion === MATCH_VIEWER_EVENT_VERSION &&
    nonNegativeInteger(value.viewerEventSequence)
  );
}

function isDurableObjectResetError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'durableObjectReset' in error &&
    (error as { durableObjectReset?: unknown }).durableObjectReset === true
  );
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
  private battleProjectionCheckpoint: AuthoritativeBattleCheckpoint | null = null;
  private battleRevision: MatchRevision | null = null;
  /** viewer cursorはraw event数ではなく、このstable step列の1-based batch連番。 */
  private battleSteps: AppliedBattleStep[] = [];
  private readonly battleCommands = new MatchCommandLedger<StoredMatchCommandResult>();

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
          persistence_version INTEGER,
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
          CHECK (applied_actions IS NULL OR applied_actions >= 0),
          CHECK (persistence_version IS NULL OR persistence_version = 1)
        );
        CREATE TABLE IF NOT EXISTS match_battle_manifest (
          manifest_key INTEGER PRIMARY KEY CHECK (manifest_key = 1),
          match_id TEXT NOT NULL UNIQUE,
          schema_version INTEGER NOT NULL CHECK (schema_version = 1),
          header_json TEXT NOT NULL,
          initial_battle_cards_json TEXT NOT NULL,
          initial_identity_hash TEXT NOT NULL,
          initial_event_count INTEGER NOT NULL,
          created_at_ms INTEGER NOT NULL,
          CHECK (length(CAST(header_json AS BLOB)) BETWEEN 1 AND 131072),
          CHECK (length(CAST(initial_battle_cards_json AS BLOB)) BETWEEN 1 AND 524288),
          CHECK (length(initial_identity_hash) = 19),
          CHECK (initial_event_count BETWEEN 0 AND ${MAX_PERSISTED_BATTLE_EVENTS}),
          CHECK (created_at_ms >= 1)
        );
        CREATE TABLE IF NOT EXISTS match_battle_state (
          state_key INTEGER PRIMARY KEY CHECK (state_key = 1),
          match_id TEXT NOT NULL UNIQUE,
          revision INTEGER NOT NULL,
          step_count INTEGER NOT NULL,
          event_count INTEGER NOT NULL,
          command_count INTEGER NOT NULL,
          rejection_count INTEGER NOT NULL,
          state_json TEXT NOT NULL,
          battle_cards_json TEXT NOT NULL,
          current_state_hash TEXT NOT NULL,
          current_identity_hash TEXT NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          CHECK (revision BETWEEN 0 AND 9007199254740990),
          CHECK (step_count BETWEEN 0 AND ${MAX_PERSISTED_BATTLE_STEPS}),
          CHECK (event_count BETWEEN 0 AND ${MAX_PERSISTED_BATTLE_EVENTS}),
          CHECK (command_count BETWEEN 0 AND 2048),
          CHECK (rejection_count BETWEEN 0 AND 512),
          CHECK (rejection_count <= command_count),
          CHECK (length(CAST(state_json AS BLOB)) BETWEEN 1 AND 1048576),
          CHECK (length(CAST(battle_cards_json AS BLOB)) BETWEEN 1 AND 524288),
          CHECK (length(current_state_hash) = 16),
          CHECK (length(current_identity_hash) = 19),
          CHECK (updated_at_ms >= 1)
        );
        CREATE TABLE IF NOT EXISTS match_battle_command (
          record_sequence INTEGER PRIMARY KEY CHECK (record_sequence >= 0),
          command_id TEXT NOT NULL UNIQUE,
          match_id TEXT NOT NULL,
          seat_id TEXT NOT NULL CHECK (seat_id IN ('player-1', 'player-2')),
          expected_revision INTEGER NOT NULL,
          canonical_payload TEXT NOT NULL,
          payload_digest TEXT NOT NULL,
          result_state TEXT NOT NULL CHECK (result_state IN ('accepted', 'rejected')),
          result_revision INTEGER NOT NULL,
          receipt_json TEXT NOT NULL,
          terminal_flag INTEGER NOT NULL DEFAULT 0 CHECK (terminal_flag IN (0, 1)),
          created_at_ms INTEGER NOT NULL,
          CHECK (expected_revision BETWEEN 0 AND 9007199254740990),
          CHECK (result_revision BETWEEN 0 AND 9007199254740990),
          CHECK (length(CAST(canonical_payload AS BLOB)) BETWEEN 1 AND 4096),
          CHECK (length(payload_digest) = 64),
          CHECK (length(CAST(receipt_json AS BLOB)) BETWEEN 1 AND 2048),
          CHECK (created_at_ms >= 1)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS match_battle_command_accepted_revision
          ON match_battle_command(result_revision) WHERE result_state = 'accepted';
        CREATE UNIQUE INDEX IF NOT EXISTS match_battle_command_terminal
          ON match_battle_command(terminal_flag) WHERE terminal_flag = 1;
        CREATE TABLE IF NOT EXISTS match_battle_step (
          step_sequence INTEGER PRIMARY KEY CHECK (step_sequence >= 0),
          command_id TEXT,
          command_revision INTEGER NOT NULL,
          player INTEGER NOT NULL CHECK (player IN (0, 1)),
          source TEXT NOT NULL CHECK (source IN ('human', 'npc')),
          step_json TEXT NOT NULL,
          state_hash TEXT NOT NULL,
          identity_hash TEXT NOT NULL,
          event_start_sequence INTEGER NOT NULL,
          event_count INTEGER NOT NULL,
          CHECK (command_revision BETWEEN 0 AND 9007199254740990),
          CHECK ((source = 'human' AND player = 0) OR (source = 'npc' AND player = 1)),
          CHECK (command_id IS NOT NULL OR (source = 'npc' AND command_revision = 0)),
          CHECK (length(CAST(step_json AS BLOB)) BETWEEN 1 AND 32768),
          CHECK (length(state_hash) = 16),
          CHECK (length(identity_hash) = 19),
          CHECK (event_start_sequence BETWEEN 0 AND ${MAX_PERSISTED_BATTLE_EVENTS}),
          CHECK (event_count BETWEEN 0 AND ${MAX_PERSISTED_BATTLE_EVENTS})
        );
        CREATE INDEX IF NOT EXISTS match_battle_step_command
          ON match_battle_step(command_id, step_sequence);
        CREATE TABLE IF NOT EXISTS match_battle_event (
          event_sequence INTEGER PRIMARY KEY CHECK (event_sequence >= 0),
          step_sequence INTEGER NOT NULL CHECK (step_sequence >= -1),
          ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
          event_json TEXT NOT NULL,
          UNIQUE (step_sequence, ordinal),
          CHECK (length(CAST(event_json AS BLOB)) BETWEEN 1 AND 8192)
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
      const lifecycleColumns = this.ctx.storage.sql.exec<{ name: string }>(
        `PRAGMA table_info(match_battle_lifecycle)`,
      ).toArray();
      if (!lifecycleColumns.some((column) => column.name === 'persistence_version')) {
        this.ctx.storage.sql.exec(
          `ALTER TABLE match_battle_lifecycle ADD COLUMN persistence_version INTEGER`,
        );
      }
      await this.hydrateBattlePersistence();
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

  /** OLG-122 commandを内部RPCで扱う。browser wireはOLG-124まで開かない。 */
  async applyNpcBattleCommand(
    input: ApplyNpcBattleCommandInput,
  ): Promise<ApplyNpcBattleCommandResult> {
    validateApplyNpcBattleCommandInput(input);
    return this.withOperationLock(() => this.applyNpcBattleCommandExclusive(input));
  }

  /** callerがoperation lockを保持した状態でcommand commitとprojection生成を直列化する。 */
  private async applyNpcBattleCommandExclusive(
    input: ApplyNpcBattleCommandInput,
  ): Promise<ApplyNpcBattleCommandResult> {
    let lifecycle = this.requireBattleLifecycle(input.principal, true);
    const command = parseMatchCommandCandidate(input.command);
    if (!command) throw new MatchBattleError('MATCH_BATTLE_INPUT_INVALID');
    const matchId = this.ctx.id.name;
    if (!matchId || command.matchId !== matchId) {
      throw new MatchBattleError('MATCH_BATTLE_INPUT_INVALID');
    }
    const revision = this.requireBattleRevision();
    let identity: MatchCommandPayloadIdentity;
    try {
      identity = await identifyMatchCommandPayload(command, 'player-1');
    } catch (error) {
      if (error instanceof MatchCommandPayloadError) {
        throw new MatchBattleError('MATCH_BATTLE_INPUT_INVALID');
      }
      throw error;
    }

    // active runtimeとcommand revisionのdriftをcached ACKでも隠さない。terminal lifecycleは
    // 保存済みledger replayだけruntime無しを許す。
    let runtime: EngineBattleAdapter | null = null;
    if (lifecycle.lifecycle_state === 'active') {
      runtime = this.requireBattleRuntime();
      if (runtime.commandRevision() !== revision) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      const finished = runtime.result();
      if (finished) {
        lifecycle = await this.persistBattleTerminal(
          lifecycle,
          this.finishedTerminalResult(finished),
        );
        runtime = null;
      }
    }

    const known = this.battleCommands.lookup(command.commandId, identity);
    if (known.state === 'replay') {
      return known.result;
    }
    if (known.state === 'conflict') {
      return this.commandIdConflictResult(command, known.originalRevision);
    }
    if (!this.battleCommands.hasCapacity()) {
      throw new MatchBattleError('MATCH_COMMAND_CAPACITY_EXCEEDED');
    }

    if (command.expectedRevision !== revision) {
      return this.persistRejectedCommandResult(
        command,
        identity,
        this.revisionMismatchCommandResult(
          command,
          revision,
          command.expectedRevision < revision ? 'stale' : 'ahead',
        ),
      );
    }
    if (lifecycle.lifecycle_state === 'provisioning') {
      throw new MatchBattleError('MATCH_STATE_UNAVAILABLE');
    }
    if (lifecycle.lifecycle_state !== 'active') {
      return this.persistRejectedCommandResult(
        command,
        identity,
        this.actionOrTerminalCommandResult(command, 'MATCH_ALREADY_TERMINAL', revision),
      );
    }
    runtime ??= this.requireBattleRuntime();
    if (runtime.commandRevision() !== revision) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }
    const alreadyFinished = runtime.result();
    if (alreadyFinished) {
      await this.persistBattleTerminal(
        lifecycle,
        this.finishedTerminalResult(alreadyFinished),
      );
      return this.persistRejectedCommandResult(
        command,
        identity,
        this.actionOrTerminalCommandResult(command, 'MATCH_ALREADY_TERMINAL', revision),
      );
    }

    if (revision >= MAX_MATCH_REVISION) {
      throw new MatchBattleError('MATCH_COMMAND_CAPACITY_EXCEEDED');
    }
    const action = parseMatchAction(command.action);
    if (!action) {
      return this.persistRejectedCommandResult(
        command,
        identity,
        this.actionOrTerminalCommandResult(command, 'MATCH_ACTION_INVALID', revision),
      );
    }
    let prepared: ReturnType<EngineBattleAdapter['prepareHumanAction']>;
    try {
      prepared = runtime.prepareHumanAction(action);
    } catch (error) {
      if (error instanceof EngineBattleAdapterError) {
        if (error.code === 'BATTLE_ACTION_INVALID') {
          return this.persistRejectedCommandResult(
            command,
            identity,
            this.actionOrTerminalCommandResult(command, 'MATCH_ACTION_INVALID', revision),
          );
        }
        // BATTLE_ENGINE_FAILURE/BATTLE_RUNTIME_INVALID/BATTLE_NPC_WATCHDOG_EXCEEDED/
        // BATTLE_NOT_HUMAN_TURN/BATTLE_ALREADY_FINISHEDはここまでの事前チェックが
        // 保証しているはずの不変条件が崩れた場合のみ起こる。何も永続化する前なので
        // MatchBattleErrorCodeの契約内へfail closedする。
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      throw error;
    }
    const nextRevision = parseMatchRevision(revision + 1);
    if (
      nextRevision === null ||
      runtime.commandRevision() !== revision ||
      prepared.nextRuntime.commandRevision() !== nextRevision
    ) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }
    return this.persistAcceptedCommandResult(
      lifecycle,
      runtime,
      prepared.nextRuntime,
      prepared.transition.steps,
      command,
      identity,
      revision,
      nextRevision,
    );
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

  /** Coordinatorがserver-owned matchIdをpositive確認した後だけ呼ぶbrowser recovery read。 */
  async getNpcBattleRecoveryStatus(
    principal: MatchSessionPrincipal,
  ): Promise<NpcBattleRecoveryStatus> {
    if (!isExactPrincipal(principal)) {
      throw new MatchBattleError('MATCH_BATTLE_INPUT_INVALID');
    }
    return this.withOperationLock(async () => {
      const existing = this.battleLifecycleRow();
      if (!existing) {
        const matchId = this.ctx.id.name;
        if (!matchId || !NPC_MATCH_ID_PATTERN.test(matchId)) {
          throw new MatchBattleError('MATCH_BATTLE_NOT_STARTED');
        }
        return { state: 'provisioning', matchId };
      }
      const lifecycle = await this.reconcileFinishedRuntime(
        this.requireBattleLifecycle(principal, true),
      );
      const stored = this.lifecycleFromRow(lifecycle);
      return {
        state:
          stored.state === 'provisioning'
            ? 'provisioning'
            : stored.state === 'active'
              ? 'active'
              : 'terminal',
        matchId: stored.matchId,
      };
    });
  }

  /** ACK-only保存値をexact commandIdで読む。unknown IDは台帳を増やさずnullへ収束する。 */
  async getNpcBattleReceipt(
    input: GetNpcBattleReceiptInput,
  ): Promise<MatchCommandResult | null> {
    validateGetNpcBattleReceiptInput(input);
    return this.withOperationLock(async () => {
      const lifecycle = await this.reconcileFinishedRuntime(
        this.requireBattleLifecycle(input.principal, true),
      );
      const commandId = parseMatchCommandId(input.commandId)!;
      const row = this.ctx.storage.sql.exec<Pick<
        BattleCommandRow,
        'command_id' | 'match_id' | 'seat_id' | 'receipt_json'
      >>(
        `SELECT command_id, match_id, seat_id, receipt_json
           FROM match_battle_command WHERE command_id = ?`,
        commandId,
      ).toArray()[0];
      if (!row) return null;
      const receipt = parseMatchCommandResult(
        decodePersistedJson(row.receipt_json, MAX_PERSISTED_RECEIPT_BYTES),
      );
      if (
        !receipt ||
        row.command_id !== commandId ||
        row.match_id !== lifecycle.match_id ||
        row.seat_id !== lifecycle.seat_id ||
        receipt.matchId !== lifecycle.match_id ||
        receipt.commandId !== commandId
      ) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      return receipt;
    });
  }

  /** hash/turn数/seedを含む内部resultを出さず、browser-safe terminal summaryだけを返す。 */
  async getNpcBattlePublicResult(
    principal: MatchSessionPrincipal,
  ): Promise<MatchTerminalProjection | null> {
    if (!isExactPrincipal(principal)) {
      throw new MatchBattleError('MATCH_BATTLE_INPUT_INVALID');
    }
    return this.withOperationLock(async () => {
      const lifecycle = await this.reconcileFinishedRuntime(
        this.requireBattleLifecycle(principal, true),
      );
      return this.terminalProjectionFor(this.lifecycleFromRow(lifecycle));
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
      const authenticatedSockets = this.captureLifecycleAuthenticatedSockets(lifecycle);
      const finished = this.battleRuntime?.result() ?? null;
      if (finished) {
        lifecycle = await this.persistBattleTerminal(
          lifecycle,
          this.finishedTerminalResult(finished),
        );
        await this.deliverLifecycleTerminalProjection(authenticatedSockets, lifecycle);
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
      await this.deliverLifecycleTerminalProjection(authenticatedSockets, lifecycle);
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
      const authenticatedSockets = this.captureLifecycleAuthenticatedSockets(lifecycle);
      const runtime = this.requireBattleRuntime();
      const finished = runtime.result();
      if (finished) {
        lifecycle = await this.persistBattleTerminal(
          lifecycle,
          this.finishedTerminalResult(finished),
        );
        await this.deliverLifecycleTerminalProjection(authenticatedSockets, lifecycle);
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
      await this.deliverLifecycleTerminalProjection(authenticatedSockets, lifecycle);
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
      try {
        await this.withOperationLock(() =>
          this.handleAuthenticatedGameFrame(socket, attachment, message));
      } catch (error) {
        if (isDurableObjectResetError(error)) throw error;
        this.closeMatchSocket(
          socket,
          MATCH_UNAVAILABLE_CLOSE_CODE,
          MATCH_UNAVAILABLE_CLOSE_REASON,
        );
      }
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
      await this.withOperationLock(async () => {
        const current = socket.deserializeAttachment() as ConnectionAttachment | null;
        if (
          current?.mode !== 'verifying' ||
          current.connectionId !== verifying.connectionId ||
          current.matchId !== verifying.matchId ||
          current.accountId !== verifying.accountId ||
          current.sessionId !== verifying.sessionId ||
          current.sessionVersion !== verifying.sessionVersion ||
          current.authDeadlineEpochMs !== verifying.authDeadlineEpochMs
        ) {
          this.closeMatchSocket(socket, AUTHENTICATION_CLOSE_CODE, AUTHENTICATION_CLOSE_REASON);
          return;
        }
        const consumed = this.consumeSeatTokenCandidates(candidates, verifying, {
          connectionId: verifying.connectionId,
          authDeadlineEpochMs: verifying.authDeadlineEpochMs,
        });
        if (consumed.state !== 'consumed') {
          await this.rejectPendingSocket(socket, verifying);
          return;
        }
        const authenticated = {
          mode: 'authenticated',
          matchId: verifying.matchId,
          connectionId: verifying.connectionId,
          accountId: verifying.accountId,
          sessionId: verifying.sessionId,
          sessionVersion: verifying.sessionVersion,
          seatId: consumed.seatId,
          assignmentVersion: consumed.assignmentVersion,
          projectionVersion: MATCH_PLAYER_PROJECTION_VERSION,
          viewerEventVersion: MATCH_VIEWER_EVENT_VERSION,
          viewerEventSequence: frame.resume?.lastEventSequence ?? 0,
        } satisfies AuthenticatedAttachment;
        socket.serializeAttachment(authenticated);
        this.ctx.storage.sql.exec(
          `DELETE FROM do_deadline WHERE deadline_key = ?`,
          pendingDeadlineKey(verifying.connectionId),
        );
        await this.ensureNextAlarm();
        await this.sendAuthenticatedReady(socket, authenticated, frame.resume !== null);
      });
    } catch (error) {
      if (isDurableObjectResetError(error)) throw error;
      const current = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (current?.mode === 'pending' || current?.mode === 'verifying') {
        await this.rejectPendingSocket(socket, current);
      } else if (current?.mode === 'authenticated') {
        this.closeMatchSocket(
          socket,
          MATCH_UNAVAILABLE_CLOSE_CODE,
          MATCH_UNAVAILABLE_CLOSE_REASON,
        );
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

  // auth frame起因の失敗（SEAT_AUTH_FRAME_TOO_LARGE／不正token／期限切れ等）は、
  // 認証確立前のsocketに対しては種別を問わず一律1008/AUTH_FAILEDへ畳む。
  // authenticated後のgame frameが1009(too large)/1008(invalid)を使い分けるのとは非対称だが、
  // 認証前は攻撃者へ失敗理由を渡さないfail closedを優先した意図的な設計。
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

  private sameAuthenticatedIdentity(
    left: AuthenticatedAttachment,
    right: AuthenticatedAttachment,
  ): boolean {
    return (
      left.mode === right.mode &&
      left.matchId === right.matchId &&
      left.connectionId === right.connectionId &&
      left.accountId === right.accountId &&
      left.sessionId === right.sessionId &&
      left.sessionVersion === right.sessionVersion &&
      left.seatId === right.seatId &&
      left.assignmentVersion === right.assignmentVersion &&
      left.projectionVersion === right.projectionVersion &&
      left.viewerEventVersion === right.viewerEventVersion
    );
  }

  private isSessionInvalidated(attachment: AuthenticatedAttachment): boolean {
    const invalidation = this.ctx.storage.sql.exec<{ invalidated_version: number }>(
      `SELECT invalidated_version FROM match_session_invalidation WHERE session_id = ?`,
      attachment.sessionId,
    ).toArray()[0];
    return Boolean(
      invalidation && invalidation.invalidated_version > attachment.sessionVersion,
    );
  }

  /** terminal commitでassignmentが消えた後も、既存socketのexact receipt再送だけを認可する。 */
  private isTerminalLifecycleOwner(
    lifecycle: BattleLifecycleRow | null | undefined,
    attachment: AuthenticatedAttachment,
  ): lifecycle is BattleLifecycleRow {
    if (!lifecycle) return false;
    const stored = this.lifecycleFromRow(lifecycle);
    return (
      stored.state !== 'provisioning' &&
      stored.state !== 'active' &&
      stored.assignmentVersion !== null &&
      stored.assignmentVersion === attachment.assignmentVersion &&
      stored.seatId === attachment.seatId &&
      samePrincipal(lifecycle, attachment)
    );
  }

  /** 同じviewerの複数tabだけ。将来PvPで相手seatへこのprojectionを転送してはいけない。 */
  private matchingSameViewerAuthenticatedSockets(
    owner: AuthenticatedAttachment,
  ): WebSocket[] {
    return this.ctx.getWebSockets().filter((candidate) => {
      const attachment = candidate.deserializeAttachment() as unknown;
      return (
        isExactAuthenticatedAttachment(attachment) &&
        attachment.matchId === owner.matchId &&
        attachment.accountId === owner.accountId &&
        attachment.sessionId === owner.sessionId &&
        attachment.sessionVersion === owner.sessionVersion &&
        attachment.seatId === owner.seatId &&
        attachment.assignmentVersion === owner.assignmentVersion
      );
    });
  }

  private captureLifecycleAuthenticatedSockets(
    lifecycle: BattleLifecycleRow,
  ): Array<{ socket: WebSocket; attachment: AuthenticatedAttachment }> {
    const stored = this.lifecycleFromRow(lifecycle);
    if (stored.assignmentVersion === null) return [];
    const captured: Array<{ socket: WebSocket; attachment: AuthenticatedAttachment }> = [];
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as unknown;
      if (
        isExactAuthenticatedAttachment(attachment) &&
        attachment.matchId === stored.matchId &&
        attachment.accountId === stored.principal.accountId &&
        attachment.sessionId === stored.principal.sessionId &&
        attachment.sessionVersion === stored.principal.sessionVersion &&
        attachment.seatId === stored.seatId &&
        attachment.assignmentVersion === stored.assignmentVersion
      ) {
        captured.push({ socket, attachment });
      }
    }
    return captured;
  }

  private terminalProjectionFor(
    lifecycle: NpcBattleLifecycle,
  ): MatchTerminalProjection | null {
    const terminal = lifecycle.terminalResult;
    if (!terminal) return null;
    if (terminal.kind === 'finished') {
      return {
        state: 'finished',
        winner: terminal.winner,
        reason: terminal.endReason,
      };
    }
    if (terminal.kind === 'cancelled') {
      return {
        state: 'cancelled',
        winner: null,
        reason: terminal.reason,
      };
    }
    return {
      state: 'abandoned',
      winner: NPC_PLAYER,
      reason: terminal.reason,
    };
  }

  private playerProjectionFor(
    attachment: AuthenticatedAttachment,
    lifecycleRow: BattleLifecycleRow,
  ): MatchPlayerProjection {
    const lifecycle = this.lifecycleFromRow(lifecycleRow);
    const matchId = parseMatchId(this.ctx.id.name);
    if (
      !matchId ||
      lifecycle.matchId !== matchId ||
      lifecycle.seatId !== attachment.seatId ||
      lifecycle.assignmentVersion !== attachment.assignmentVersion ||
      !samePrincipal(lifecycleRow, attachment) ||
      !this.battleProjectionCheckpoint ||
      this.battleProjectionCheckpoint.stepCount !== this.battleSteps.length
    ) {
      throw new MatchBattleError('MATCH_BATTLE_ACCESS_DENIED');
    }
    return createPlayerBattleProjection(this.battleProjectionCheckpoint, {
      matchId,
      viewerSeat: attachment.seatId,
      revision: this.requireBattleRevision(),
      eventSequence: this.battleSteps.length,
      contentVersion: lifecycle.versions.contentVersion,
      formatVersionId: lifecycle.versions.formatVersionId,
      terminal: this.terminalProjectionFor(lifecycle),
    });
  }

  private viewerSyncFor(
    attachment: AuthenticatedAttachment,
    projection: MatchPlayerProjection,
    initialSnapshot: boolean,
  ): MatchViewerSync {
    const currentSequence = projection.eventSequence;
    if (
      projection.viewerSeat !== attachment.seatId ||
      projection.viewerEventVersion !== MATCH_VIEWER_EVENT_VERSION ||
      currentSequence !== this.battleSteps.length
    ) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }
    if (initialSnapshot) {
      return {
        type: 'matchViewerSync',
        mode: 'snapshot',
        reason: 'initial',
        eventSequence: currentSequence,
      };
    }
    const after = attachment.viewerEventSequence;
    if (after > currentSequence) {
      return {
        type: 'matchViewerSync',
        mode: 'snapshot',
        reason: 'cursor_ahead',
        eventSequence: currentSequence,
      };
    }
    if (currentSequence - after > MAX_MATCH_RESUME_EVENT_BATCHES) {
      return {
        type: 'matchViewerSync',
        mode: 'snapshot',
        reason: 'cursor_gap',
        eventSequence: currentSequence,
      };
    }
    const batches: MatchViewerEventBatch[] = this.battleSteps
      .slice(after)
      .map((step) => createMatchViewerEventBatch(step, attachment.seatId));
    return {
      type: 'matchViewerSync',
      mode: 'delta',
      afterEventSequence: after,
      batches,
    };
  }

  private serializeViewerFrame(
    attachment: AuthenticatedAttachment,
    projection: MatchPlayerProjection,
    receipt: MatchCommandResult | null,
    initialSnapshot = false,
  ): string {
    let sync = this.viewerSyncFor(attachment, projection, initialSnapshot);
    const frame = (): MatchServerFrame => receipt
      ? { type: 'matchCommandUpdate', receipt, projection, sync }
      : { type: 'matchProjection', projection, sync };
    try {
      return serializeMatchServerFrame(frame());
    } catch (error) {
      if (
        !(error instanceof MatchWireFrameError) ||
        error.code !== 'MATCH_FRAME_OUTPUT_TOO_LARGE' ||
        sync.mode !== 'delta'
      ) {
        throw error;
      }
      sync = {
        type: 'matchViewerSync',
        mode: 'snapshot',
        reason: 'delta_too_large',
        eventSequence: projection.eventSequence,
      };
      return serializeMatchServerFrame(frame());
    }
  }

  private advanceViewerCursor(
    socket: WebSocket,
    attachment: AuthenticatedAttachment,
    eventSequence: number,
  ): void {
    socket.serializeAttachment({
      ...attachment,
      viewerEventSequence: eventSequence,
    } satisfies AuthenticatedAttachment);
  }

  private closeMatchSocket(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason);
    } catch {
      // terminal commitや他socketへの配信を、個別socketのclose失敗で巻き戻さない。
    }
  }

  private async sendAuthenticatedReady(
    socket: WebSocket,
    expected: AuthenticatedAttachment,
    resumeRequested: boolean,
  ): Promise<void> {
    const current = socket.deserializeAttachment() as unknown;
    if (
      !isExactAuthenticatedAttachment(current) ||
      !this.sameAuthenticatedIdentity(current, expected) ||
      current.matchId !== this.ctx.id.name
    ) {
      this.closeMatchSocket(socket, AUTHENTICATION_CLOSE_CODE, AUTHENTICATION_CLOSE_REASON);
      return;
    }
    if (this.isSessionInvalidated(current)) {
      this.closeMatchSocket(socket, AUTHENTICATION_CLOSE_CODE, SESSION_CLOSE_REASON);
      return;
    }
    if (!this.isCurrentAssignment(current)) {
      this.closeMatchSocket(socket, AUTHENTICATION_CLOSE_CODE, SEAT_CLOSE_REASON);
      return;
    }

    const lifecycle = this.battleLifecycleRow();
    // withOperationLockがstartNpcBattleExclusiveとこの認証完了処理を直列化するため、
    // 通常経路では'provisioning'を観測しない（HTTPレスポンスを返す前に'active'か終了状態へ遷移済み）。
    // 到達し得るのはprocess evictionでprovisioning行だけが永続化された直後の再接続のみで、
    // その場合もprojectionを送らずauth_okのみで応答するfail-closedな防御である。
    if (!lifecycle || lifecycle.lifecycle_state === 'provisioning') {
      try {
        socket.send('auth_ok');
      } catch {
        this.closeMatchSocket(socket, MATCH_UNAVAILABLE_CLOSE_CODE, MATCH_UNAVAILABLE_CLOSE_REASON);
      }
      return;
    }

    let projection: MatchPlayerProjection;
    let encodedProjection: string;
    try {
      projection = this.playerProjectionFor(current, lifecycle);
      encodedProjection = this.serializeViewerFrame(
        current,
        projection,
        null,
        !resumeRequested,
      );
    } catch (error) {
      if (
        error instanceof MatchBattleError ||
        error instanceof EngineBattleAdapterError ||
        error instanceof ViewerEventProjectionError ||
        error instanceof MatchWireFrameError
      ) {
        this.closeMatchSocket(socket, MATCH_UNAVAILABLE_CLOSE_CODE, MATCH_UNAVAILABLE_CLOSE_REASON);
        return;
      }
      throw error;
    }
    try {
      socket.send('auth_ok');
      socket.send(encodedProjection);
      this.advanceViewerCursor(socket, current, projection.eventSequence);
    } catch {
      this.closeMatchSocket(socket, MATCH_UNAVAILABLE_CLOSE_CODE, MATCH_UNAVAILABLE_CLOSE_REASON);
    }
  }

  private async deliverMatchProjection(
    origin: WebSocket,
    recipients: readonly WebSocket[],
    projection: MatchPlayerProjection,
    receipt: MatchCommandResult | null,
  ): Promise<void> {
    const affected = recipients.includes(origin) ? [...recipients] : [origin, ...recipients];
    const deliveries: Array<{
      socket: WebSocket;
      attachment: AuthenticatedAttachment;
      payload: string;
    }> = [];
    try {
      for (const socket of affected) {
        const attachment = socket.deserializeAttachment() as unknown;
        if (
          !isExactAuthenticatedAttachment(attachment) ||
          attachment.matchId !== projection.matchId ||
          attachment.seatId !== projection.viewerSeat
        ) {
          throw new MatchBattleError('MATCH_BATTLE_ACCESS_DENIED');
        }
        deliveries.push({
          socket,
          attachment,
          payload: this.serializeViewerFrame(
            attachment,
            projection,
            socket === origin ? receipt : null,
          ),
        });
      }
    } catch (error) {
      if (
        !(error instanceof MatchWireFrameError) &&
        !(error instanceof MatchBattleError) &&
        !(error instanceof ViewerEventProjectionError)
      ) {
        throw error;
      }
      for (const socket of affected) {
        this.closeMatchSocket(
          socket,
          MATCH_UNAVAILABLE_CLOSE_CODE,
          MATCH_UNAVAILABLE_CLOSE_REASON,
        );
      }
      return;
    }

    for (const delivery of deliveries) {
      try {
        delivery.socket.send(delivery.payload);
        this.advanceViewerCursor(
          delivery.socket,
          delivery.attachment,
          projection.eventSequence,
        );
      } catch {
        this.closeMatchSocket(
          delivery.socket,
          MATCH_UNAVAILABLE_CLOSE_CODE,
          MATCH_UNAVAILABLE_CLOSE_REASON,
        );
      }
    }

    if (!projection.terminal) return;
    await this.runBattleWireCutpoint(
      () => this.afterTerminalFrameSend(),
      'MATCH_TERMINAL_POST_SEND_FAILED',
    );
    for (const socket of affected) {
      this.closeMatchSocket(socket, MATCH_ENDED_CLOSE_CODE, MATCH_ENDED_CLOSE_REASON);
    }
    await this.runBattleWireCutpoint(
      () => this.afterTerminalSocketsClose(),
      'MATCH_TERMINAL_POST_CLOSE_FAILED',
    );
  }

  private async deliverLifecycleTerminalProjection(
    captured: readonly { socket: WebSocket; attachment: AuthenticatedAttachment }[],
    lifecycle: BattleLifecycleRow,
  ): Promise<void> {
    const origin = captured[0];
    if (!origin) return;
    let projection: MatchPlayerProjection;
    try {
      projection = this.playerProjectionFor(origin.attachment, lifecycle);
      if (!projection.terminal) throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    } catch (error) {
      if (error instanceof MatchBattleError || error instanceof EngineBattleAdapterError) {
        for (const recipient of captured) {
          this.closeMatchSocket(
            recipient.socket,
            MATCH_UNAVAILABLE_CLOSE_CODE,
            MATCH_UNAVAILABLE_CLOSE_REASON,
          );
        }
        return;
      }
      throw error;
    }
    await this.deliverMatchProjection(
      origin.socket,
      captured.map((recipient) => recipient.socket),
      projection,
      null,
    );
  }

  private async handleAuthenticatedGameFrame(
    socket: WebSocket,
    expected: AuthenticatedAttachment,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const current = socket.deserializeAttachment() as unknown;
    if (
      !isExactAuthenticatedAttachment(current) ||
      !this.sameAuthenticatedIdentity(current, expected) ||
      current.matchId !== this.ctx.id.name
    ) {
      this.closeMatchSocket(socket, AUTHENTICATION_CLOSE_CODE, AUTHENTICATION_CLOSE_REASON);
      return;
    }
    if (this.isSessionInvalidated(current)) {
      this.closeMatchSocket(socket, AUTHENTICATION_CLOSE_CODE, SESSION_CLOSE_REASON);
      return;
    }

    let lifecycleBefore = this.battleLifecycleRow();
    try {
      if (lifecycleBefore) this.lifecycleFromRow(lifecycleBefore);
    } catch (error) {
      if (error instanceof MatchBattleError) {
        this.closeMatchSocket(socket, MATCH_UNAVAILABLE_CLOSE_CODE, MATCH_UNAVAILABLE_CLOSE_REASON);
        return;
      }
      throw error;
    }
    const terminalOwner = this.isTerminalLifecycleOwner(lifecycleBefore, current);
    if (!this.isCurrentAssignment(current) && !terminalOwner) {
      this.closeMatchSocket(socket, AUTHENTICATION_CLOSE_CODE, SEAT_CLOSE_REASON);
      return;
    }

    let frame: ReturnType<typeof parseMatchCommandWebSocketFrame>;
    try {
      frame = parseMatchCommandWebSocketFrame(message);
    } catch (error) {
      if (!(error instanceof MatchWireFrameError)) throw error;
      this.closeMatchSocket(
        socket,
        error.code === 'MATCH_FRAME_TOO_LARGE'
          ? MATCH_FRAME_TOO_LARGE_CLOSE_CODE
          : AUTHENTICATION_CLOSE_CODE,
        error.code === 'MATCH_FRAME_TOO_LARGE'
          ? MATCH_FRAME_TOO_LARGE_CLOSE_REASON
          : MATCH_FRAME_INVALID_CLOSE_REASON,
      );
      return;
    }
    if (frame.command.matchId !== current.matchId) {
      this.closeMatchSocket(socket, AUTHENTICATION_CLOSE_CODE, MATCH_FRAME_INVALID_CLOSE_REASON);
      return;
    }

    const recipients = this.matchingSameViewerAuthenticatedSockets(current);
    let receipt: MatchCommandResult | null = null;
    if (terminalOwner) {
      let identity: MatchCommandPayloadIdentity;
      try {
        identity = await identifyMatchCommandPayload(frame.command, current.seatId);
      } catch (error) {
        if (error instanceof MatchCommandPayloadError) {
          this.closeMatchSocket(socket, AUTHENTICATION_CLOSE_CODE, MATCH_FRAME_INVALID_CLOSE_REASON);
          return;
        }
        throw error;
      }
      const known = this.battleCommands.lookup(frame.command.commandId, identity);
      if (known.state === 'replay') receipt = known.result;
      if (known.state === 'conflict') {
        receipt = this.commandIdConflictResult(frame.command, known.originalRevision);
      }
      // terminal後の未知commandは台帳を増やさず、current terminal projectionだけ返す。
    } else {
      try {
        receipt = await this.applyNpcBattleCommandExclusive({
          principal: current,
          command: frame.command,
        });
      } catch (error) {
        if (error instanceof MatchBattleError) {
          this.closeMatchSocket(
            socket,
            error.code === 'MATCH_BATTLE_INPUT_INVALID'
              ? AUTHENTICATION_CLOSE_CODE
              : MATCH_UNAVAILABLE_CLOSE_CODE,
            error.code === 'MATCH_BATTLE_INPUT_INVALID'
              ? MATCH_FRAME_INVALID_CLOSE_REASON
              : MATCH_UNAVAILABLE_CLOSE_REASON,
          );
          return;
        }
        throw error;
      }
      lifecycleBefore = this.battleLifecycleRow();
    }

    if (!lifecycleBefore) {
      this.closeMatchSocket(socket, MATCH_UNAVAILABLE_CLOSE_CODE, MATCH_UNAVAILABLE_CLOSE_REASON);
      return;
    }
    let projection: MatchPlayerProjection;
    try {
      projection = this.playerProjectionFor(current, lifecycleBefore);
    } catch (error) {
      if (error instanceof MatchBattleError || error instanceof EngineBattleAdapterError) {
        this.closeMatchSocket(socket, MATCH_UNAVAILABLE_CLOSE_CODE, MATCH_UNAVAILABLE_CLOSE_REASON);
        return;
      }
      throw error;
    }
    await this.deliverMatchProjection(socket, recipients, projection, receipt);
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
        if (
          !this.battleRuntime ||
          !this.battleProjectionCheckpoint ||
          this.battleRevision === null
        ) {
          return { state: 'unavailable' };
        }
        if (this.battleRuntime.commandRevision() !== this.battleRevision) {
          throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
        }
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

    const initialRevision = parseMatchRevision(0);
    if (initialRevision === null || runtime.commandRevision() !== initialRevision) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }
    const immediateResult = runtime.result();
    const snapshot = runtime.authoritativeSnapshot();
    const headerJson = encodePersistedJson(snapshot.header, MAX_PERSISTED_HEADER_BYTES);
    const initialBattleCardsJson = encodePersistedJson(
      snapshot.initialBattleCards,
      MAX_PERSISTED_INITIAL_CARDS_BYTES,
    );
    const initialEventJson = snapshot.initialEvents.map((event) =>
      encodePersistedJson(event, MAX_PERSISTED_EVENT_BYTES));
    const preparedRuntime = this.prepareBattleRuntimePersistence(
      runtime,
      snapshot.steps,
      null,
      initialRevision,
      initialEventJson.length,
    );
    const initialBytes =
      jsonBytes(headerJson) +
      jsonBytes(initialBattleCardsJson) +
      initialEventJson.reduce((sum, encoded) => sum + jsonBytes(encoded), 0) +
      preparedRuntime.encodedBytes;
    if (
      initialEventJson.length > MAX_PERSISTED_BATTLE_EVENTS ||
      !IDENTITY_HASH_PATTERN.test(snapshot.initialIdentityHash) ||
      initialBytes > MAX_PERSISTED_BATTLE_HISTORY_BYTES
    ) {
      throw new MatchBattleError('MATCH_COMMAND_CAPACITY_EXCEEDED');
    }
    const terminal = immediateResult
      ? this.prepareBattleTerminal(lifecycle, this.finishedTerminalResult(immediateResult))
      : null;
    const persistedAtEpochMs = Math.max(Date.now(), lifecycle.started_at_ms);
    await this.ctx.storage.transaction(async (transaction) => {
      this.ctx.storage.sql.exec(
        `INSERT INTO match_battle_manifest (
           manifest_key, match_id, schema_version, header_json,
           initial_battle_cards_json, initial_identity_hash, initial_event_count,
           created_at_ms
         ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
        matchId,
        BATTLE_PERSISTENCE_VERSION,
        headerJson,
        initialBattleCardsJson,
        snapshot.initialIdentityHash,
        initialEventJson.length,
        persistedAtEpochMs,
      );
      for (const [sequence, eventJson] of initialEventJson.entries()) {
        this.ctx.storage.sql.exec(
          `INSERT INTO match_battle_event (
             event_sequence, step_sequence, ordinal, event_json
           ) VALUES (?, -1, ?, ?)`,
          sequence,
          sequence,
          eventJson,
        );
      }
      this.writePreparedBattleSteps(preparedRuntime.steps);
      this.ctx.storage.sql.exec(
        `INSERT INTO match_battle_state (
           state_key, match_id, revision, step_count, event_count, command_count,
           rejection_count, state_json, battle_cards_json, current_state_hash,
           current_identity_hash, updated_at_ms
         ) VALUES (1, ?, 0, ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
        matchId,
        snapshot.steps.length,
        preparedRuntime.nextEventCount,
        preparedRuntime.stateJson,
        preparedRuntime.battleCardsJson,
        snapshot.currentStateHash,
        snapshot.currentIdentityHash,
        persistedAtEpochMs,
      );
      if (terminal) {
        this.writeBattleTerminal(terminal);
        await this.ensureNextAlarmInTransaction(transaction);
      } else {
        const activated = this.ctx.storage.sql.exec<{ lifecycle_state: string }>(
          `UPDATE match_battle_lifecycle
              SET lifecycle_state = 'active', assignment_version = ?,
                  persistence_version = ?
            WHERE lifecycle_key = 1 AND lifecycle_state = 'provisioning'
              AND match_id = ? AND account_id = ? AND session_id = ?
              AND session_version = ? AND seed = ?
            RETURNING lifecycle_state`,
          assignment.assignmentVersion,
          BATTLE_PERSISTENCE_VERSION,
          matchId,
          input.principal.accountId,
          input.principal.sessionId,
          input.principal.sessionVersion,
          input.seed,
        ).toArray();
        if (activated.length !== 1) {
          throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
        }
      }
    });
    await this.runBattleCommandCutpoint(
      () => this.afterBattleActivationCommit(),
      'MATCH_BATTLE_POST_ACTIVATION_COMMIT_FAILED',
    );
    this.battleRuntime = terminal ? null : runtime;
    this.battleProjectionCheckpoint = structuredClone(preparedRuntime.checkpoint);
    this.battleRevision = initialRevision;
    this.battleSteps = structuredClone(snapshot.steps);
    this.battleCommands.clear();
    return { state: 'ready', created };
  }

  private battlePersistenceCounts(): BattlePersistenceCounts {
    return this.ctx.storage.sql.exec<BattlePersistenceCounts>(
      `SELECT
         (SELECT COUNT(*) FROM match_battle_manifest) AS manifests,
         (SELECT COUNT(*) FROM match_battle_state) AS states,
         (SELECT COUNT(*) FROM match_battle_command) AS commands,
         (SELECT COUNT(*) FROM match_battle_step) AS steps,
         (SELECT COUNT(*) FROM match_battle_event) AS events`,
    ).one();
  }

  /** 大きなJSON rowをmaterializeする前にSQLite側で総byte数をfail closed判定する。 */
  private battlePersistenceStoredBytes(): number {
    return this.ctx.storage.sql.exec<{ byte_count: number }>(
      `SELECT
         COALESCE((SELECT SUM(length(CAST(header_json AS BLOB)) +
                              length(CAST(initial_battle_cards_json AS BLOB)))
                     FROM match_battle_manifest), 0) +
         COALESCE((SELECT SUM(length(CAST(state_json AS BLOB)) +
                              length(CAST(battle_cards_json AS BLOB)))
                     FROM match_battle_state), 0) +
         COALESCE((SELECT SUM(length(CAST(canonical_payload AS BLOB)) +
                              length(CAST(receipt_json AS BLOB)))
                     FROM match_battle_command), 0) +
         COALESCE((SELECT SUM(length(CAST(step_json AS BLOB)))
                     FROM match_battle_step), 0) +
         COALESCE((SELECT SUM(length(CAST(event_json AS BLOB)))
                     FROM match_battle_event), 0) AS byte_count`,
    ).one().byte_count;
  }

  /** constructorのinput gate内でだけ呼び、全decode成功後にmemoryへinstallする。 */
  private async hydrateBattlePersistence(): Promise<void> {
    try {
      await this.hydrateBattlePersistenceExact();
    } catch {
      // constructor input gate専用reason。通常operationのSTATE_INVALIDと分け、
      // testの意図したDO resetだけをexactに観測できるようにする。
      throw new MatchBattleError('MATCH_BATTLE_PERSISTENCE_INVALID');
    }
  }

  private async hydrateBattlePersistenceExact(): Promise<void> {
    this.battleRuntime = null;
    this.battleProjectionCheckpoint = null;
    this.battleRevision = null;
    this.battleSteps = [];
    this.battleCommands.clear();
    const lifecycle = this.battleLifecycleRow();
    const counts = this.battlePersistenceCounts();
    const assignments = this.ctx.storage.sql.exec<AssignmentReferenceRow>(
      `SELECT seat_id, account_id, session_id, session_version, assignment_version,
              coordinator_registration_id, coordinator_registration_epoch_ms
         FROM match_seat_assignment ORDER BY seat_id`,
    ).toArray();
    const terminalReleases = this.ctx.storage.sql.exec<TerminalReleaseRow>(
      `SELECT registration_id, registration_epoch_ms, seat_id, account_id,
              session_id, session_version, match_id, seed, release_phase, retry_attempt
         FROM match_terminal_release ORDER BY seat_id`,
    ).toArray();
    const terminalDeadlines = this.ctx.storage.sql.exec<{
      deadline_key: string;
      due_at_ms: number;
    }>(
      `SELECT deadline_key, due_at_ms FROM do_deadline
        WHERE deadline_kind = ? ORDER BY deadline_key`,
      TERMINAL_RELEASE_DEADLINE_KIND,
    ).toArray();
    const totalPersistenceRows =
      counts.manifests + counts.states + counts.commands + counts.steps + counts.events;
    if (!lifecycle) {
      if (
        totalPersistenceRows !== 0 ||
        terminalReleases.length !== 0 ||
        terminalDeadlines.length !== 0
      ) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      return;
    }
    this.lifecycleFromRow(lifecycle);
    if (
      terminalReleases.length > 1 ||
      terminalDeadlines.length !== terminalReleases.length
    ) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }
    const terminalDeadlineKeys = new Set(
      terminalDeadlines.map((deadline) => {
        if (!positiveInteger(deadline.due_at_ms)) {
          throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
        }
        return deadline.deadline_key;
      }),
    );
    for (const release of terminalReleases) {
      this.validateTerminalRelease(release);
      if (
        release.seat_id !== 'player-1' ||
        release.account_id !== lifecycle.account_id ||
        release.session_id !== lifecycle.session_id ||
        release.session_version !== lifecycle.session_version ||
        release.match_id !== lifecycle.match_id ||
        release.seed !== lifecycle.seed ||
        !terminalDeadlineKeys.has(terminalReleaseDeadlineKey(release.registration_id))
      ) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
    }

    const runtimeLessCancellation =
      lifecycle.lifecycle_state === 'cancelled' &&
      lifecycle.turns === null &&
      lifecycle.final_state_hash === null &&
      lifecycle.applied_actions === null;
    if (lifecycle.lifecycle_state === 'provisioning') {
      if (
        totalPersistenceRows !== 0 ||
        lifecycle.persistence_version !== null ||
        terminalReleases.length !== 0
      ) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      return;
    }
    if (runtimeLessCancellation) {
      if (totalPersistenceRows !== 0 || lifecycle.persistence_version !== null) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      if (assignments.length !== 0) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      return;
    }
    if (
      (lifecycle.lifecycle_state === 'active' && terminalReleases.length !== 0) ||
      (lifecycle.lifecycle_state !== 'active' && assignments.length !== 0)
    ) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }
    if (
      lifecycle.persistence_version !== BATTLE_PERSISTENCE_VERSION ||
      counts.manifests !== 1 ||
      counts.states !== 1 ||
      counts.steps > MAX_PERSISTED_BATTLE_STEPS ||
      counts.events > MAX_PERSISTED_BATTLE_EVENTS ||
      counts.commands > MAX_MATCH_COMMAND_RECORDS
    ) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }
    const storedBytes = this.battlePersistenceStoredBytes();
    if (
      !Number.isSafeInteger(storedBytes) ||
      storedBytes < 1 ||
      storedBytes > MAX_PERSISTED_BATTLE_HISTORY_BYTES
    ) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }

    const manifest = this.ctx.storage.sql.exec<BattleManifestRow>(
      `SELECT match_id, schema_version, header_json, initial_battle_cards_json,
              initial_identity_hash, initial_event_count, created_at_ms
         FROM match_battle_manifest WHERE manifest_key = 1`,
    ).one();
    const storedState = this.ctx.storage.sql.exec<BattleStateRow>(
      `SELECT match_id, revision, step_count, event_count, command_count,
              rejection_count, state_json, battle_cards_json, current_state_hash,
              current_identity_hash, updated_at_ms
         FROM match_battle_state WHERE state_key = 1`,
    ).one();
    const commandRows = this.ctx.storage.sql.exec<BattleCommandRow>(
      `SELECT record_sequence, command_id, match_id, seat_id, expected_revision,
              canonical_payload, payload_digest, result_state, result_revision,
              receipt_json, terminal_flag, created_at_ms
         FROM match_battle_command ORDER BY record_sequence`,
    ).toArray();
    const stepRows = this.ctx.storage.sql.exec<BattleStepRow>(
      `SELECT step_sequence, command_id, command_revision, player, source, step_json,
              state_hash, identity_hash, event_start_sequence, event_count
         FROM match_battle_step ORDER BY step_sequence`,
    ).toArray();
    const eventRows = this.ctx.storage.sql.exec<BattleEventRow>(
      `SELECT event_sequence, step_sequence, ordinal, event_json
         FROM match_battle_event ORDER BY event_sequence`,
    ).toArray();

    if (
      manifest.match_id !== lifecycle.match_id ||
      manifest.match_id !== this.ctx.id.name ||
      manifest.schema_version !== BATTLE_PERSISTENCE_VERSION ||
      !positiveInteger(manifest.created_at_ms) ||
      manifest.created_at_ms < lifecycle.started_at_ms ||
      !nonNegativeInteger(manifest.initial_event_count) ||
      manifest.initial_event_count > eventRows.length ||
      !IDENTITY_HASH_PATTERN.test(manifest.initial_identity_hash) ||
      storedState.match_id !== manifest.match_id ||
      storedState.step_count !== stepRows.length ||
      storedState.event_count !== eventRows.length ||
      storedState.command_count !== commandRows.length ||
      !nonNegativeInteger(storedState.rejection_count) ||
      storedState.rejection_count > MAX_MATCH_COMMAND_REJECTION_RECORDS ||
      !positiveInteger(storedState.updated_at_ms) ||
      storedState.updated_at_ms < manifest.created_at_ms ||
      !STATE_HASH_PATTERN.test(storedState.current_state_hash) ||
      !IDENTITY_HASH_PATTERN.test(storedState.current_identity_hash)
    ) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }
    const revision = parseMatchRevision(storedState.revision);
    if (revision === null) throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');

    const header = decodePersistedJson(manifest.header_json, MAX_PERSISTED_HEADER_BYTES);
    const initialBattleCards = decodePersistedJson(
      manifest.initial_battle_cards_json,
      MAX_PERSISTED_INITIAL_CARDS_BYTES,
    );
    const currentState = decodePersistedJson(storedState.state_json, MAX_PERSISTED_STATE_BYTES);
    const currentBattleCards = decodePersistedJson(
      storedState.battle_cards_json,
      MAX_PERSISTED_BATTLE_CARDS_BYTES,
    );
    let historyBytes =
      jsonBytes(manifest.header_json) +
      jsonBytes(manifest.initial_battle_cards_json) +
      jsonBytes(storedState.state_json) +
      jsonBytes(storedState.battle_cards_json);

    const decodedEvents: unknown[] = [];
    for (const [sequence, row] of eventRows.entries()) {
      if (
        row.event_sequence !== sequence ||
        !Number.isSafeInteger(row.step_sequence) ||
        row.step_sequence < -1 ||
        !nonNegativeInteger(row.ordinal)
      ) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      historyBytes += jsonBytes(row.event_json);
      decodedEvents.push(decodePersistedJson(row.event_json, MAX_PERSISTED_EVENT_BYTES));
    }
    for (let sequence = 0; sequence < manifest.initial_event_count; sequence += 1) {
      const row = eventRows[sequence];
      if (!row || row.step_sequence !== -1 || row.ordinal !== sequence) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
    }
    if (eventRows[manifest.initial_event_count]?.step_sequence === -1) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }

    const restoredSteps: AppliedBattleStep[] = [];
    const stepCommandIds: Array<MatchCommandId | null> = [];
    let eventCursor = manifest.initial_event_count;
    let humanRevision = 0;
    for (const [sequence, row] of stepRows.entries()) {
      const commandRevision = parseMatchRevision(row.command_revision);
      const commandId = row.command_id === null ? null : parseMatchCommandId(row.command_id);
      if (
        row.step_sequence !== sequence ||
        commandRevision === null ||
        (row.command_id !== null && !commandId) ||
        (row.player !== HUMAN_PLAYER && row.player !== NPC_PLAYER) ||
        (row.source !== 'human' && row.source !== 'npc') ||
        !STATE_HASH_PATTERN.test(row.state_hash) ||
        !IDENTITY_HASH_PATTERN.test(row.identity_hash) ||
        row.event_start_sequence !== eventCursor ||
        !nonNegativeInteger(row.event_count) ||
        eventCursor + row.event_count > eventRows.length
      ) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      const decodedStep = decodePersistedJson(row.step_json, MAX_PERSISTED_STEP_BYTES);
      historyBytes += jsonBytes(row.step_json);
      if (
        !plainObject(decodedStep) ||
        !hasExactKeys(decodedStep, [
          'sequence',
          'player',
          'source',
          'action',
          'stateHash',
          'identityHash',
        ]) ||
        decodedStep.sequence !== sequence ||
        decodedStep.player !== row.player ||
        decodedStep.source !== row.source ||
        decodedStep.stateHash !== row.state_hash ||
        decodedStep.identityHash !== row.identity_hash
      ) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      if (row.source === 'human') {
        humanRevision += 1;
        if (
          row.player !== HUMAN_PLAYER ||
          commandId === null ||
          commandRevision !== humanRevision
        ) {
          throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
        }
      } else if (
        row.player !== NPC_PLAYER ||
        commandRevision !== humanRevision ||
        (humanRevision === 0 ? commandId !== null : commandId === null)
      ) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      const events: unknown[] = [];
      for (let ordinal = 0; ordinal < row.event_count; ordinal += 1) {
        const eventRow = eventRows[eventCursor + ordinal];
        if (
          !eventRow ||
          eventRow.step_sequence !== sequence ||
          eventRow.ordinal !== ordinal
        ) {
          throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
        }
        events.push(decodedEvents[eventCursor + ordinal]);
      }
      eventCursor += row.event_count;
      restoredSteps.push({
        ...(decodedStep as unknown as PersistedBattleStepValue),
        events,
      } as AppliedBattleStep);
      stepCommandIds.push(commandId);
    }
    if (
      eventCursor !== eventRows.length ||
      humanRevision !== revision ||
      historyBytes > MAX_PERSISTED_BATTLE_HISTORY_BYTES
    ) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }

    let runtime: EngineBattleAdapter;
    try {
      runtime = EngineBattleAdapter.restoreFromHistory({
        header,
        initialBattleCards,
        initialIdentityHash: manifest.initial_identity_hash,
        steps: restoredSteps,
      });
    } catch {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }
    const restored = runtime.authoritativeSnapshot();
    if (
      restored.header.seed !== lifecycle.seed ||
      !this.lifecycleVersionsMatch(lifecycle, restored.header) ||
      canonicalBattlePersistenceJson(restored.initialEvents) !==
        canonicalBattlePersistenceJson(decodedEvents.slice(0, manifest.initial_event_count)) ||
      canonicalBattlePersistenceJson(restored.state) !==
        canonicalBattlePersistenceJson(currentState) ||
      canonicalBattlePersistenceJson(restored.battleCards) !==
        canonicalBattlePersistenceJson(currentBattleCards) ||
      restored.steps.length !== storedState.step_count ||
      restored.currentStateHash !== storedState.current_state_hash ||
      restored.currentIdentityHash !== storedState.current_identity_hash ||
      restored.state.eventSeq !== storedState.event_count ||
      runtime.commandRevision() !== revision
    ) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }

    const hydratedCommands: Array<{
      commandId: MatchCommandId;
      identity: MatchCommandPayloadIdentity;
      result: StoredMatchCommandResult;
    }> = [];
    const acceptedCommands = new Map<number, MatchCommandId>();
    const trialLedger = new MatchCommandLedger<StoredMatchCommandResult>();
    let acceptedRevision = 0;
    let rejectedCount = 0;
    let terminalCommandCount = 0;
    for (const [sequence, row] of commandRows.entries()) {
      const commandId = parseMatchCommandId(row.command_id);
      const expectedRevision = parseMatchRevision(row.expected_revision);
      const resultRevision = parseMatchRevision(row.result_revision);
      const receiptValue = decodePersistedJson(row.receipt_json, MAX_PERSISTED_RECEIPT_BYTES);
      const receipt = parseMatchCommandResult(receiptValue);
      if (
        row.record_sequence !== sequence ||
        !commandId ||
        expectedRevision === null ||
        resultRevision === null ||
        row.match_id !== lifecycle.match_id ||
        row.seat_id !== 'player-1' ||
        !positiveInteger(row.created_at_ms) ||
        (row.result_state !== 'accepted' && row.result_state !== 'rejected') ||
        (row.terminal_flag !== 0 && row.terminal_flag !== 1) ||
        !receipt
      ) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      if (
        !isStoredMatchCommandResult(receipt) ||
        receipt.matchId !== row.match_id ||
        receipt.commandId !== commandId ||
        receipt.state !== row.result_state ||
        receipt.revision !== resultRevision
      ) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      historyBytes +=
        jsonBytes(row.canonical_payload) +
        jsonBytes(row.receipt_json);
      if (historyBytes > MAX_PERSISTED_BATTLE_HISTORY_BYTES) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      const identity = await validateStoredMatchCommandPayloadIdentity({
        commandId,
        matchId: row.match_id,
        seatId: row.seat_id,
        expectedRevision,
        canonicalPayload: row.canonical_payload,
        payloadDigest: row.payload_digest,
      });
      if (receipt.state === 'accepted') {
        acceptedRevision += 1;
        if (
          receipt.baseRevision !== acceptedRevision - 1 ||
          receipt.revision !== acceptedRevision ||
          expectedRevision !== receipt.baseRevision
        ) {
          throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
        }
        acceptedCommands.set(acceptedRevision, commandId);
      } else {
        rejectedCount += 1;
        if (
          receipt.revision !== acceptedRevision ||
          (receipt.errorCode === 'MATCH_REVISION_MISMATCH' &&
            ((receipt.relation === 'stale' && expectedRevision >= acceptedRevision) ||
              (receipt.relation === 'ahead' && expectedRevision <= acceptedRevision))) ||
          (receipt.errorCode !== 'MATCH_REVISION_MISMATCH' &&
            expectedRevision !== acceptedRevision)
        ) {
          throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
        }
      }
      if (row.terminal_flag === 1) {
        terminalCommandCount += 1;
        if (receipt.state !== 'accepted' || receipt.revision !== storedState.revision) {
          throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
        }
      }
      trialLedger.remember(commandId, identity, receipt);
      hydratedCommands.push({ commandId, identity, result: receipt });
    }
    if (
      acceptedRevision !== revision ||
      rejectedCount !== storedState.rejection_count ||
      trialLedger.size !== storedState.command_count ||
      terminalCommandCount > 1
    ) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }
    for (const [sequence, row] of stepRows.entries()) {
      if (row.command_revision === 0) continue;
      if (stepCommandIds[sequence] !== acceptedCommands.get(row.command_revision)) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
    }

    const runtimeResult = runtime.result();
    const runtimeStatus = runtime.status();
    if (lifecycle.lifecycle_state === 'active') {
      const assignment = assignments[0];
      if (
        assignments.length !== 1 ||
        !assignment ||
        assignment.seat_id !== 'player-1' ||
        assignment.account_id !== lifecycle.account_id ||
        assignment.session_id !== lifecycle.session_id ||
        assignment.session_version !== lifecycle.session_version ||
        assignment.assignment_version !== lifecycle.assignment_version ||
        typeof assignment.coordinator_registration_id !== 'string' ||
        !UUID_PATTERN.test(assignment.coordinator_registration_id) ||
        !positiveInteger(assignment.coordinator_registration_epoch_ms) ||
        runtimeResult !== null ||
        terminalCommandCount !== 0
      ) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
    } else {
      if (assignments.length !== 0) throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      const terminal = this.lifecycleFromRow(lifecycle).terminalResult;
      if (!terminal) throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      if (terminal.kind === 'finished') {
        if (
          !runtimeResult ||
          runtimeResult.winner !== terminal.winner ||
          runtimeResult.endReason !== terminal.endReason ||
          runtimeResult.turns !== terminal.turns ||
          runtimeResult.finalStateHash !== terminal.finalStateHash ||
          runtimeResult.appliedActions !== terminal.appliedActions ||
          (revision === 0 ? terminalCommandCount !== 0 : terminalCommandCount !== 1)
        ) {
          throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
        }
      } else if (
        runtimeResult !== null ||
        terminal.turns !== runtimeStatus.turn ||
        terminal.finalStateHash !== runtimeStatus.stateHash ||
        terminal.appliedActions !== runtimeStatus.appliedActions ||
        terminalCommandCount !== 0
      ) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
    }

    this.battleCommands.clear();
    for (const command of hydratedCommands) {
      this.battleCommands.remember(command.commandId, command.identity, command.result);
    }
    this.battleRevision = revision;
    this.battleProjectionCheckpoint = runtime.authoritativeCheckpoint();
    this.battleSteps = structuredClone(restoredSteps);
    this.battleRuntime = lifecycle.lifecycle_state === 'active' ? runtime : null;
  }

  private battleLifecycleRow(): BattleLifecycleRow | undefined {
    return this.ctx.storage.sql.exec<BattleLifecycleRow>(
      `SELECT match_id, lifecycle_state, account_id, session_id, session_version,
              seat_id, assignment_version, seed, adapter_version, engine_version,
              content_version, format_version_id, npc_policy_id, started_at_ms,
              terminal_at_ms, terminal_reason, winner, engine_end_reason, turns,
              final_state_hash, applied_actions, persistence_version
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
      (row.lifecycle_state === 'provisioning' &&
        (row.assignment_version !== null || row.persistence_version !== null)) ||
      ((row.lifecycle_state === 'active' ||
        row.lifecycle_state === 'finished' ||
        row.lifecycle_state === 'abandoned') &&
        (!positiveInteger(row.assignment_version) ||
          row.persistence_version !== BATTLE_PERSISTENCE_VERSION))
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
        (hasNoRuntimeResult && row.persistence_version !== null) ||
        (hasCompleteRuntimeResult &&
          (!positiveInteger(row.assignment_version) ||
            row.persistence_version !== BATTLE_PERSISTENCE_VERSION))
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

  private requireBattleRevision(): MatchRevision {
    if (this.battleRevision === null) {
      throw new MatchBattleError('MATCH_STATE_UNAVAILABLE');
    }
    return this.battleRevision;
  }

  private revisionMismatchCommandResult(
    command: MatchCommandCandidate,
    revision: MatchRevision,
    relation: RevisionMismatchCommandResult['relation'],
  ): RevisionMismatchCommandResult {
    return {
      type: 'matchCommandResult',
      state: 'rejected',
      matchId: command.matchId,
      commandId: command.commandId,
      errorCode: 'MATCH_REVISION_MISMATCH',
      revision,
      relation,
    };
  }

  private actionOrTerminalCommandResult(
    command: MatchCommandCandidate,
    errorCode: ActionOrTerminalCommandResult['errorCode'],
    revision: MatchRevision,
  ): ActionOrTerminalCommandResult {
    return {
      type: 'matchCommandResult',
      state: 'rejected',
      matchId: command.matchId,
      commandId: command.commandId,
      errorCode,
      revision,
    };
  }

  private commandIdConflictResult(
    command: MatchCommandCandidate,
    originalRevision: MatchRevision,
  ): CommandIdConflictResult {
    return {
      type: 'matchCommandResult',
      state: 'rejected',
      matchId: command.matchId,
      commandId: command.commandId,
      errorCode: 'MATCH_COMMAND_ID_CONFLICT',
      originalRevision,
    };
  }

  private rememberCommandResult(
    command: MatchCommandCandidate,
    identity: MatchCommandPayloadIdentity,
    result: StoredMatchCommandResult,
  ): StoredMatchCommandResult {
    try {
      return this.battleCommands.remember(command.commandId, identity, result);
    } catch (error) {
      if (error instanceof MatchCommandLedgerError) {
        if (
          error.code === 'MATCH_COMMAND_CAPACITY_EXCEEDED' ||
          error.code === 'MATCH_COMMAND_REJECTION_CAPACITY_EXCEEDED'
        ) {
          throw new MatchBattleError('MATCH_COMMAND_CAPACITY_EXCEEDED');
        }
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      throw error;
    }
  }

  private installCommittedCommandResult(
    command: MatchCommandCandidate,
    identity: MatchCommandPayloadIdentity,
    result: StoredMatchCommandResult,
  ): StoredMatchCommandResult {
    try {
      return this.rememberCommandResult(command, identity, result);
    } catch (error) {
      this.ctx.abort('MATCH_COMMAND_CACHE_INSTALL_FAILED');
      throw error;
    }
  }

  private battleImmutableHistoryBytes(): number {
    return this.ctx.storage.sql.exec<{ byte_count: number }>(
      `SELECT
         COALESCE((SELECT SUM(length(CAST(header_json AS BLOB)) +
                              length(CAST(initial_battle_cards_json AS BLOB)))
                     FROM match_battle_manifest), 0) +
         COALESCE((SELECT SUM(length(CAST(canonical_payload AS BLOB)) +
                              length(CAST(receipt_json AS BLOB)))
                     FROM match_battle_command), 0) +
         COALESCE((SELECT SUM(length(CAST(step_json AS BLOB)))
                     FROM match_battle_step), 0) +
         COALESCE((SELECT SUM(length(CAST(event_json AS BLOB)))
                     FROM match_battle_event), 0) AS byte_count`,
    ).one().byte_count;
  }

  private prepareBattleRuntimePersistence(
    runtime: EngineBattleAdapter,
    appendedSteps: readonly AppliedBattleStep[],
    commandId: MatchCommandId | null,
    commandRevision: MatchRevision,
    currentEventCount: number,
  ): PreparedBattleRuntimePersistence {
    const checkpoint = runtime.authoritativeCheckpoint();
    if (
      !nonNegativeInteger(currentEventCount) ||
      currentEventCount > MAX_PERSISTED_BATTLE_EVENTS ||
      checkpoint.stepCount > MAX_PERSISTED_BATTLE_STEPS ||
      appendedSteps.length > checkpoint.stepCount ||
      runtime.commandRevision() !== commandRevision ||
      !STATE_HASH_PATTERN.test(checkpoint.currentStateHash) ||
      !IDENTITY_HASH_PATTERN.test(checkpoint.currentIdentityHash)
    ) {
      throw new MatchBattleError('MATCH_COMMAND_CAPACITY_EXCEEDED');
    }
    const firstSequence = checkpoint.stepCount - appendedSteps.length;
    let eventCursor = currentEventCount;
    let encodedBytes = 0;
    const steps: PreparedBattleStepInsert[] = [];
    for (const [offset, step] of appendedSteps.entries()) {
      if (
        step.sequence !== firstSequence + offset ||
        !STATE_HASH_PATTERN.test(step.stateHash) ||
        !IDENTITY_HASH_PATTERN.test(step.identityHash) ||
        !Array.isArray(step.events)
      ) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      const stepJson = encodePersistedJson(
        persistedBattleStepValue(step),
        MAX_PERSISTED_STEP_BYTES,
      );
      const eventJson = step.events.map((event) =>
        encodePersistedJson(event, MAX_PERSISTED_EVENT_BYTES));
      if (eventCursor + eventJson.length > MAX_PERSISTED_BATTLE_EVENTS) {
        throw new MatchBattleError('MATCH_COMMAND_CAPACITY_EXCEEDED');
      }
      encodedBytes += jsonBytes(stepJson);
      for (const encoded of eventJson) encodedBytes += jsonBytes(encoded);
      steps.push({
        step: structuredClone(step),
        commandId,
        commandRevision,
        stepJson,
        eventStartSequence: eventCursor,
        eventJson,
      });
      eventCursor += eventJson.length;
    }
    const stateJson = encodePersistedJson(checkpoint.state, MAX_PERSISTED_STATE_BYTES);
    const battleCardsJson = encodePersistedJson(
      checkpoint.battleCards,
      MAX_PERSISTED_BATTLE_CARDS_BYTES,
    );
    encodedBytes += jsonBytes(stateJson) + jsonBytes(battleCardsJson);
    if (
      checkpoint.state.eventSeq !== eventCursor ||
      (checkpoint.stepCount > 0 &&
        (checkpoint.currentStateHash !== appendedSteps.at(-1)?.stateHash ||
          checkpoint.currentIdentityHash !== appendedSteps.at(-1)?.identityHash))
    ) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }
    return {
      checkpoint,
      stateJson,
      battleCardsJson,
      steps,
      nextEventCount: eventCursor,
      encodedBytes,
    };
  }

  private writePreparedBattleSteps(steps: readonly PreparedBattleStepInsert[]): void {
    for (const prepared of steps) {
      this.ctx.storage.sql.exec(
        `INSERT INTO match_battle_step (
           step_sequence, command_id, command_revision, player, source, step_json,
           state_hash, identity_hash, event_start_sequence, event_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        prepared.step.sequence,
        prepared.commandId,
        prepared.commandRevision,
        prepared.step.player,
        prepared.step.source,
        prepared.stepJson,
        prepared.step.stateHash,
        prepared.step.identityHash,
        prepared.eventStartSequence,
        prepared.eventJson.length,
      );
      for (const [ordinal, eventJson] of prepared.eventJson.entries()) {
        this.ctx.storage.sql.exec(
          `INSERT INTO match_battle_event (
             event_sequence, step_sequence, ordinal, event_json
           ) VALUES (?, ?, ?, ?)`,
          prepared.eventStartSequence + ordinal,
          prepared.step.sequence,
          ordinal,
          eventJson,
        );
      }
    }
  }

  private writeCommandRecord(
    recordSequence: number,
    command: MatchCommandCandidate,
    identity: MatchCommandPayloadIdentity,
    result: StoredMatchCommandResult,
    receiptJson: string,
    terminal: boolean,
    createdAtEpochMs: number,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO match_battle_command (
         record_sequence, command_id, match_id, seat_id, expected_revision,
         canonical_payload, payload_digest, result_state, result_revision,
         receipt_json, terminal_flag, created_at_ms
       ) VALUES (?, ?, ?, 'player-1', ?, ?, ?, ?, ?, ?, ?, ?)`,
      recordSequence,
      command.commandId,
      command.matchId,
      command.expectedRevision,
      identity.canonicalPayload,
      identity.payloadDigest,
      result.state,
      result.revision,
      receiptJson,
      terminal ? 1 : 0,
      createdAtEpochMs,
    );
  }

  private async persistRejectedCommandResult(
    command: MatchCommandCandidate,
    identity: MatchCommandPayloadIdentity,
    result: StoredMatchCommandResult & { state: 'rejected' },
  ): Promise<StoredMatchCommandResult> {
    if (!this.battleCommands.hasCapacity('rejected')) {
      throw new MatchBattleError('MATCH_COMMAND_CAPACITY_EXCEEDED');
    }
    const state = this.ctx.storage.sql.exec<BattleStateRow>(
      `SELECT match_id, revision, step_count, event_count, command_count,
              rejection_count, state_json, battle_cards_json, current_state_hash,
              current_identity_hash, updated_at_ms
         FROM match_battle_state WHERE state_key = 1`,
    ).toArray()[0];
    const receiptJson = encodePersistedJson(result, MAX_PERSISTED_RECEIPT_BYTES);
    if (
      !state ||
      state.match_id !== command.matchId ||
      state.revision !== this.requireBattleRevision() ||
      state.command_count !== this.battleCommands.size ||
      state.rejection_count !== this.battleCommands.rejectedSize
    ) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }
    if (
      this.battleImmutableHistoryBytes() +
        jsonBytes(identity.canonicalPayload) +
        jsonBytes(receiptJson) +
        jsonBytes(state.state_json) +
        jsonBytes(state.battle_cards_json) >
      MAX_PERSISTED_BATTLE_HISTORY_BYTES
    ) {
      throw new MatchBattleError('MATCH_COMMAND_CAPACITY_EXCEEDED');
    }
    const now = Math.max(Date.now(), state.updated_at_ms);
    this.ctx.storage.transactionSync(() => {
      this.writeCommandRecord(
        state.command_count,
        command,
        identity,
        result,
        receiptJson,
        false,
        now,
      );
      const updated = this.ctx.storage.sql.exec<{ command_count: number }>(
        `UPDATE match_battle_state
            SET command_count = command_count + 1,
                rejection_count = rejection_count + 1,
                updated_at_ms = ?
          WHERE state_key = 1 AND match_id = ? AND revision = ?
            AND command_count = ? AND rejection_count = ?
          RETURNING command_count`,
        now,
        command.matchId,
        state.revision,
        state.command_count,
        state.rejection_count,
      ).toArray();
      if (updated.length !== 1) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
    });
    await this.runBattleCommandCutpoint(
      () => this.afterBattleCommandCommit(),
      'MATCH_COMMAND_POST_COMMIT_FAILED',
    );
    const installed = this.installCommittedCommandResult(command, identity, result);
    await this.runBattleCommandCutpoint(
      () => this.afterBattleCommandInstall(),
      'MATCH_COMMAND_POST_INSTALL_FAILED',
    );
    return installed;
  }

  private async persistAcceptedCommandResult(
    lifecycle: BattleLifecycleRow,
    currentRuntime: EngineBattleAdapter,
    nextRuntime: EngineBattleAdapter,
    appendedSteps: readonly AppliedBattleStep[],
    command: MatchCommandCandidate,
    identity: MatchCommandPayloadIdentity,
    baseRevision: MatchRevision,
    nextRevision: MatchRevision,
  ): Promise<AcceptedMatchCommandResult> {
    if (!this.battleCommands.hasCapacity('accepted')) {
      throw new MatchBattleError('MATCH_COMMAND_CAPACITY_EXCEEDED');
    }
    const state = this.ctx.storage.sql.exec<BattleStateRow>(
      `SELECT match_id, revision, step_count, event_count, command_count,
              rejection_count, state_json, battle_cards_json, current_state_hash,
              current_identity_hash, updated_at_ms
         FROM match_battle_state WHERE state_key = 1`,
    ).toArray()[0];
    const currentSnapshot = currentRuntime.authoritativeSnapshot();
    if (
      !state ||
      state.match_id !== command.matchId ||
      state.revision !== baseRevision ||
      command.expectedRevision !== baseRevision ||
      state.command_count !== this.battleCommands.size ||
      state.rejection_count !== this.battleCommands.rejectedSize ||
      state.step_count !== currentSnapshot.steps.length ||
      state.step_count !== this.battleSteps.length ||
      state.event_count !== currentSnapshot.state.eventSeq ||
      state.current_state_hash !== currentSnapshot.currentStateHash ||
      state.current_identity_hash !== currentSnapshot.currentIdentityHash ||
      state.state_json !== canonicalBattlePersistenceJson(currentSnapshot.state) ||
      state.battle_cards_json !== canonicalBattlePersistenceJson(currentSnapshot.battleCards) ||
      appendedSteps.length < 1 ||
      appendedSteps[0]?.source !== 'human' ||
      appendedSteps.filter((step) => step.source === 'human').length !== 1
    ) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }
    const nextBattleSteps = this.battleSteps.concat(structuredClone(appendedSteps));
    const preparedRuntime = this.prepareBattleRuntimePersistence(
      nextRuntime,
      appendedSteps,
      command.commandId,
      nextRevision,
      state.event_count,
    );
    if (
      preparedRuntime.checkpoint.stepCount !== state.step_count + appendedSteps.length ||
      preparedRuntime.checkpoint.stepCount > MAX_PERSISTED_BATTLE_STEPS
    ) {
      throw new MatchBattleError('MATCH_COMMAND_CAPACITY_EXCEEDED');
    }
    const result: AcceptedMatchCommandResult = {
      type: 'matchCommandResult',
      state: 'accepted',
      matchId: command.matchId,
      commandId: command.commandId,
      baseRevision,
      revision: nextRevision,
    };
    const receiptJson = encodePersistedJson(result, MAX_PERSISTED_RECEIPT_BYTES);
    const terminalResult = nextRuntime.result();
    const terminal = terminalResult
      ? this.prepareBattleTerminal(lifecycle, this.finishedTerminalResult(terminalResult))
      : null;
    if (
      this.battleImmutableHistoryBytes() +
        jsonBytes(identity.canonicalPayload) +
        jsonBytes(receiptJson) +
        preparedRuntime.encodedBytes >
      MAX_PERSISTED_BATTLE_HISTORY_BYTES
    ) {
      throw new MatchBattleError('MATCH_COMMAND_CAPACITY_EXCEEDED');
    }
    const now = Math.max(Date.now(), state.updated_at_ms);
    await this.ctx.storage.transaction(async (transaction) => {
      this.writeCommandRecord(
        state.command_count,
        command,
        identity,
        result,
        receiptJson,
        terminal !== null,
        now,
      );
      this.writePreparedBattleSteps(preparedRuntime.steps);
      const updated = this.ctx.storage.sql.exec<{ revision: number }>(
        `UPDATE match_battle_state
            SET revision = ?, step_count = ?, event_count = ?,
                command_count = command_count + 1,
                state_json = ?, battle_cards_json = ?,
                current_state_hash = ?, current_identity_hash = ?, updated_at_ms = ?
          WHERE state_key = 1 AND match_id = ? AND revision = ?
            AND step_count = ? AND event_count = ? AND command_count = ?
            AND rejection_count = ? AND current_state_hash = ?
            AND current_identity_hash = ?
          RETURNING revision`,
        nextRevision,
        preparedRuntime.checkpoint.stepCount,
        preparedRuntime.nextEventCount,
        preparedRuntime.stateJson,
        preparedRuntime.battleCardsJson,
        preparedRuntime.checkpoint.currentStateHash,
        preparedRuntime.checkpoint.currentIdentityHash,
        now,
        command.matchId,
        baseRevision,
        state.step_count,
        state.event_count,
        state.command_count,
        state.rejection_count,
        state.current_state_hash,
        state.current_identity_hash,
      ).toArray();
      if (updated.length !== 1 || updated[0]?.revision !== nextRevision) {
        throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
      }
      if (terminal) {
        this.writeBattleTerminal(terminal);
        await this.ensureNextAlarmInTransaction(transaction);
      }
    });

    await this.runBattleCommandCutpoint(
      () => this.afterBattleCommandCommit(),
      'MATCH_COMMAND_POST_COMMIT_FAILED',
    );
    const installed = this.installCommittedCommandResult(command, identity, result);
    this.battleRevision = nextRevision;
    this.battleProjectionCheckpoint = structuredClone(preparedRuntime.checkpoint);
    this.battleSteps = nextBattleSteps;
    this.battleRuntime = terminal ? null : nextRuntime;
    await this.runBattleCommandCutpoint(
      () => this.afterBattleCommandInstall(),
      'MATCH_COMMAND_POST_INSTALL_FAILED',
    );
    return installed as AcceptedMatchCommandResult;
  }

  /** crash境界を明示するno-op。testはbarrierへ差し替え、本物のDO tear-downを当てる。 */
  private async afterBattleActivationCommit(): Promise<void> {}

  private async afterBattleCommandCommit(): Promise<void> {}

  private async afterBattleCommandInstall(): Promise<void> {}

  private async afterTerminalFrameSend(): Promise<void> {}

  private async afterTerminalSocketsClose(): Promise<void> {}

  private async runBattleCommandCutpoint(
    cutpoint: () => Promise<void>,
    abortReason: string,
  ): Promise<void> {
    try {
      await cutpoint();
    } catch (error) {
      this.ctx.abort(abortReason);
      throw error;
    }
  }

  private async runBattleWireCutpoint(
    cutpoint: () => Promise<void>,
    abortReason: string,
  ): Promise<void> {
    try {
      await cutpoint();
    } catch (error) {
      this.ctx.abort(abortReason);
      throw error;
    }
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
    if (!result) return lifecycle;
    const authenticatedSockets = this.captureLifecycleAuthenticatedSockets(lifecycle);
    const terminal = await this.persistBattleTerminal(
      lifecycle,
      this.finishedTerminalResult(result),
    );
    await this.deliverLifecycleTerminalProjection(authenticatedSockets, terminal);
    return terminal;
  }

  /** 外部RPCやsocket操作をせず、同じSQLite transactionへ書ける終端planだけを作る。 */
  private prepareBattleTerminal(
    lifecycle: BattleLifecycleRow,
    terminal: NpcBattleTerminalResult,
  ): PreparedBattleTerminal {
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

    const hasRuntimeState =
      nonNegativeInteger(terminal.turns) &&
      typeof terminal.finalStateHash === 'string' &&
      STATE_HASH_PATTERN.test(terminal.finalStateHash) &&
      nonNegativeInteger(terminal.appliedActions);
    if (
      (lifecycle.lifecycle_state === 'active' && !hasRuntimeState) ||
      (terminal.kind !== 'cancelled' && !hasRuntimeState)
    ) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }
    const terminalAtEpochMs = Math.max(Date.now(), lifecycle.started_at_ms);
    const assignmentVersion = hasRuntimeState
      ? assignments[0]?.assignment_version ?? lifecycle.assignment_version
      : lifecycle.assignment_version;
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

    return {
      lifecycle,
      terminal,
      terminalAtEpochMs,
      assignmentVersion,
      dueAtEpochMs,
      releases,
    };
  }

  private writeBattleTerminal(prepared: PreparedBattleTerminal): void {
    const { lifecycle, terminal } = prepared;
    const terminalReason = terminal.kind === 'finished' ? null : terminal.reason;
    const engineEndReason = terminal.kind === 'finished' ? terminal.endReason : null;
    const persistenceVersion = terminal.finalStateHash === null
      ? null
      : BATTLE_PERSISTENCE_VERSION;
    const updated = this.ctx.storage.sql.exec<{ lifecycle_state: string }>(
      `UPDATE match_battle_lifecycle
          SET lifecycle_state = ?, assignment_version = ?, terminal_at_ms = ?,
              terminal_reason = ?, winner = ?, engine_end_reason = ?, turns = ?,
              final_state_hash = ?, applied_actions = ?, persistence_version = ?
        WHERE lifecycle_key = 1 AND lifecycle_state = ?
          AND match_id = ? AND account_id = ? AND session_id = ?
          AND session_version = ? AND seed = ?
        RETURNING lifecycle_state`,
      terminal.kind,
      prepared.assignmentVersion,
      prepared.terminalAtEpochMs,
      terminalReason,
      terminal.winner,
      engineEndReason,
      terminal.turns,
      terminal.finalStateHash,
      terminal.appliedActions,
      persistenceVersion,
      lifecycle.lifecycle_state,
      lifecycle.match_id,
      lifecycle.account_id,
      lifecycle.session_id,
      lifecycle.session_version,
      lifecycle.seed,
    ).toArray();
    if (updated.length !== 1) {
      throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    }

    for (const release of prepared.releases) {
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
        release.match_id,
        release.seed,
        release.release_phase,
      );
      this.upsertTerminalReleaseDeadline(release.registration_id, prepared.dueAtEpochMs);
    }
    this.ctx.storage.sql.exec(`DELETE FROM match_seat_token`);
    this.ctx.storage.sql.exec(`DELETE FROM match_seat_assignment`);
    // pending/verifying socketはACK対象ではない。既存ws-auth deadlineを残し、alarmで必ずcloseする。
    // authenticated socketのprojection/ACK後closeはbrowser wireを所有するOLG-124で行う。
  }

  /** ACKを外部cleanupから独立させ、commit後はalarmだけがCoordinatorへ接触する。 */
  private async persistBattleTerminal(
    lifecycle: BattleLifecycleRow,
    terminal: NpcBattleTerminalResult,
  ): Promise<BattleLifecycleRow> {
    const prepared = this.prepareBattleTerminal(lifecycle, terminal);
    await this.ctx.storage.transaction(async (transaction) => {
      this.writeBattleTerminal(prepared);
      await this.ensureNextAlarmInTransaction(transaction);
    });
    this.battleRuntime = null;
    const stored = this.battleLifecycleRow();
    if (!stored) throw new MatchBattleError('MATCH_BATTLE_STATE_INVALID');
    return stored;
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
