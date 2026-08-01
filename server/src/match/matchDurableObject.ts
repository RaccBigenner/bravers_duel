import { DurableObject } from 'cloudflare:workers';
import { createSessionRuntimeConfig } from '../auth/sessionRuntimeConfig';
import type { TokenDigestCandidate } from '../auth/sessionCrypto';
import {
  generateSeatToken,
  parseSeatAuthFrame,
  seatTokenDigestCandidates,
  seatTokenDigestHex,
} from './seatToken';

const MATCH_PATH = /^\/matches\/([A-Za-z0-9_-]{1,64})\/ws$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const PROBE_PREFIX = 'probe:';
const AUTHENTICATION_CLOSE_CODE = 1008;
const AUTHENTICATION_CLOSE_REASON = 'AUTH_FAILED';
const SESSION_CLOSE_REASON = 'SESSION_ENDED';
const SEAT_CLOSE_REASON = 'SEAT_REASSIGNED';

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
  [key: string]: string | number;
  seat_id: string;
  account_id: string;
  session_id: string;
  session_version: number;
  assignment_version: number;
}

interface TokenMatchRow {
  [key: string]: string | number;
  token_digest: string;
  digest_key_version: number;
  seat_id: string;
  assignment_version: number;
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

function isPrincipal(value: MatchSessionPrincipal): boolean {
  return (
    UUID_PATTERN.test(value.accountId) &&
    UUID_PATTERN.test(value.sessionId) &&
    positiveInteger(value.sessionVersion)
  );
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

export function matchIdFromPath(pathname: string): string | null {
  return pathname.match(MATCH_PATH)?.[1] ?? null;
}

/**
 * MatchDOはmatchごとのassignment/token/connection正本。
 * OLG-121がassignSeatを呼ぶまではissueSeatTokenの正方向は成立しない。
 */
export class MatchDO extends DurableObject<Env> {
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
          updated_at_ms INTEGER NOT NULL,
          CHECK (seat_id IN ('player-1', 'player-2')),
          CHECK (session_version >= 1),
          CHECK (assignment_version >= 1)
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
      `);
    });
  }

  async sqliteReady(): Promise<boolean> {
    return this.ctx.storage.sql.exec<{ ok: number }>('SELECT 1 AS ok').one().ok === 1;
  }

  async assignSeat(
    input: MatchSessionPrincipal & { seatId: MatchSeatId },
  ): Promise<SeatAssignmentResult> {
    if (!isPrincipal(input) || !isSeatId(input.seatId)) {
      throw new TypeError('MATCH_SEAT_ASSIGNMENT_INVALID');
    }
    const result = this.ctx.storage.transactionSync(() => {
      const invalidation = this.ctx.storage.sql.exec<{ invalidated_version: number }>(
        `SELECT invalidated_version FROM match_session_invalidation WHERE session_id = ?`,
        input.sessionId,
      ).toArray()[0];
      if (invalidation && invalidation.invalidated_version >= input.sessionVersion) {
        return { state: 'conflict' } as const;
      }

      const duplicate = this.ctx.storage.sql.exec<AssignmentRow>(
        `SELECT seat_id, account_id, session_id, session_version, assignment_version
           FROM match_seat_assignment
          WHERE (account_id = ? OR session_id = ?) AND seat_id <> ?`,
        input.accountId,
        input.sessionId,
        input.seatId,
      ).toArray();
      if (duplicate.length > 0) return { state: 'conflict' } as const;

      const current = this.ctx.storage.sql.exec<AssignmentRow>(
        `SELECT seat_id, account_id, session_id, session_version, assignment_version
           FROM match_seat_assignment WHERE seat_id = ?`,
        input.seatId,
      ).toArray()[0];
      if (
        current &&
        current.account_id === input.accountId &&
        current.session_id === input.sessionId &&
        current.session_version === input.sessionVersion
      ) {
        return {
          state: 'assigned',
          seatId: input.seatId,
          assignmentVersion: current.assignment_version,
        } as const;
      }

      const assignmentVersion = (current?.assignment_version ?? 0) + 1;
      this.ctx.storage.sql.exec(
        `DELETE FROM match_seat_token WHERE seat_id = ?`,
        input.seatId,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO match_seat_assignment (
           seat_id, account_id, session_id, session_version, assignment_version, updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(seat_id) DO UPDATE SET
           account_id = excluded.account_id,
           session_id = excluded.session_id,
           session_version = excluded.session_version,
           assignment_version = excluded.assignment_version,
           updated_at_ms = excluded.updated_at_ms`,
        input.seatId,
        input.accountId,
        input.sessionId,
        input.sessionVersion,
        assignmentVersion,
        Date.now(),
      );
      return { state: 'assigned', seatId: input.seatId, assignmentVersion } as const;
    });
    if (result.state === 'assigned') {
      this.closeStaleSeatConnections(result.seatId, result.assignmentVersion);
    }
    return result;
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
                AND NOT EXISTS (
                  SELECT 1 FROM match_session_invalidation AS invalidation
                   WHERE invalidation.session_id = assignment.session_id
                     AND invalidation.invalidated_version >= assignment.session_version
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
                     AND invalidation.invalidated_version >= token.session_version
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

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: { Allow: 'GET' } });
    }
    if (!isWebSocketUpgrade(request)) {
      return json({ error: 'WEBSOCKET_UPGRADE_REQUIRED' }, { status: 426 });
    }
    const url = new URL(request.url);
    const matchId = matchIdFromPath(url.pathname);
    if (!matchId || url.search !== '') {
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
      if (invalidated && invalidated.invalidated_version >= attachment.sessionVersion) {
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
    const now = Date.now();
    const due = this.ctx.storage.sql.exec<{ deadline_key: string }>(
      `SELECT deadline_key FROM do_deadline WHERE due_at_ms <= ?`,
      now,
    ).toArray();
    const dueKeys = new Set(due.map((row) => row.deadline_key));
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (
        (attachment?.mode === 'pending' || attachment?.mode === 'verifying') &&
        dueKeys.has(pendingDeadlineKey(attachment.connectionId)) &&
        attachment.authDeadlineEpochMs <= now
      ) {
        socket.close(AUTHENTICATION_CLOSE_CODE, AUTHENTICATION_CLOSE_REASON);
      }
    }
    this.ctx.storage.sql.exec(`DELETE FROM do_deadline WHERE due_at_ms <= ?`, now);
    await this.rescheduleAfterAlarm();
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
          AND assignment_version = ?`,
      attachment.seatId,
      attachment.accountId,
      attachment.sessionId,
      attachment.sessionVersion,
      attachment.assignmentVersion,
    ).toArray();
    return rows.length === 1;
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
