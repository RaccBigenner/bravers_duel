import { env } from 'cloudflare:workers';
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createSessionCryptoKeys } from '../src/auth/sessionCrypto';
import {
  INTERNAL_ACCOUNT_ID_HEADER,
  INTERNAL_SESSION_ID_HEADER,
  INTERNAL_SESSION_VERSION_HEADER,
  MatchDO,
  MAX_OUTSTANDING_SEAT_TOKENS,
  SEAT_AUTH_FRAME_TIMEOUT_MS,
  SEAT_TOKEN_TTL_MS,
  type MatchSessionPrincipal,
  type MatchSeatId,
} from '../src/match/matchDurableObject';
import {
  createMatchAccessRequestHandler,
  type MatchAccessBindings,
} from '../src/http/matchAccessController';
import type { SessionCoordinatorDO } from '../src/session/sessionCoordinatorDurableObject';
import {
  generateSeatToken,
  seatTokenDigestCandidates,
} from '../src/match/seatToken';

type MatchStub = DurableObjectStub<MatchDO>;
type SessionCoordinatorStub = DurableObjectStub<SessionCoordinatorDO>;
type SqlRow = Record<string, string | number | null>;

type SocketOutcome =
  | { kind: 'message'; data: string }
  | { kind: 'close'; code: number; reason: string };

let matchSequence = 0;

function matchId(label: string): string {
  matchSequence += 1;
  return `olg113-${label}-${matchSequence}-${crypto.randomUUID().slice(0, 8)}`;
}

function principal(overrides: Partial<MatchSessionPrincipal> = {}): MatchSessionPrincipal {
  return {
    accountId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    sessionVersion: 1,
    ...overrides,
  };
}

function stubFor(id: string): MatchStub {
  return env.MATCH_DO.get(env.MATCH_DO.idFromName(id));
}

function coordinatorFor(sessionId: string): SessionCoordinatorStub {
  return env.SESSION_COORDINATOR_DO.get(
    env.SESSION_COORDINATOR_DO.idFromName(sessionId),
  );
}

function deterministicKeyMaterial(byte: number): string {
  return generateSeatToken((bytes) => {
    bytes.fill(byte);
    return bytes;
  });
}

function rotatedSeatTokenKeys(): {
  keys: ReturnType<typeof createSessionCryptoKeys>;
  activeVersion: number;
  retainedVersion: number;
} {
  const current = JSON.parse(env.SESSION_HMAC_KEYS) as {
    activeVersion: number;
    keys: Array<{ keyVersion: number; material: string }>;
  };
  const retained = current.keys.find(
    (candidate) => candidate.keyVersion === current.activeVersion,
  );
  if (!retained) throw new Error('Expected current test HMAC key');
  const activeVersion = retained.keyVersion + 1;
  return {
    keys: createSessionCryptoKeys({
      hmac: {
        activeVersion,
        keys: [
          retained,
          { keyVersion: activeVersion, material: deterministicKeyMaterial(0xdd) },
        ],
      },
      encryption: {
        activeVersion: 30_000,
        keys: [{ keyVersion: 30_000, material: deterministicKeyMaterial(0xee) }],
      },
    }),
    activeVersion,
    retainedVersion: retained.keyVersion,
  };
}

function socketOutcome(socket: WebSocket, timeoutMs = 2_000): Promise<SocketOutcome> {
  return new Promise((resolve, reject) => {
    const finish = (outcome: SocketOutcome) => {
      cleanup();
      resolve(outcome);
    };
    const onMessage = (event: MessageEvent) => {
      finish({ kind: 'message', data: String(event.data) });
    };
    const onClose = (event: CloseEvent) => {
      finish({ kind: 'close', code: event.code, reason: event.reason });
    };
    const onError = () => {
      cleanup();
      reject(new Error('Unexpected WebSocket error'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket outcome'));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
      socket.removeEventListener('error', onError);
    };

    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose);
    socket.addEventListener('error', onError);
  });
}

async function openPlayerSocket(
  stub: MatchStub,
  id: string,
  session: MatchSessionPrincipal,
): Promise<WebSocket> {
  const response = await stub.fetch(
    new Request(`http://local.test/matches/${id}/ws`, {
      headers: {
        Upgrade: 'websocket',
        [INTERNAL_ACCOUNT_ID_HEADER]: session.accountId,
        [INTERNAL_SESSION_ID_HEADER]: session.sessionId,
        [INTERNAL_SESSION_VERSION_HEADER]: String(session.sessionVersion),
      },
    }),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error('Expected WebSocket response');
  socket.accept();
  return socket;
}

async function assignAndIssue(
  stub: MatchStub,
  session: MatchSessionPrincipal,
  seatId: MatchSeatId = 'player-1',
): Promise<{ seatToken: string; expiresAtEpochMs: number; assignmentVersion: number }> {
  const assignment = await stub.assignSeat({ ...session, seatId });
  expect(assignment.state).toBe('assigned');
  if (assignment.state !== 'assigned') throw new Error('Expected assigned seat');

  const beforeIssue = Date.now();
  const issued = await stub.issueSeatToken(session);
  const afterIssue = Date.now();
  expect(issued.state).toBe('issued');
  if (issued.state !== 'issued') throw new Error('Expected issued seat token');
  expect(issued.expiresAtEpochMs).toBeGreaterThanOrEqual(beforeIssue + SEAT_TOKEN_TTL_MS);
  expect(issued.expiresAtEpochMs).toBeLessThanOrEqual(afterIssue + SEAT_TOKEN_TTL_MS);
  return { ...issued, assignmentVersion: assignment.assignmentVersion };
}

async function authenticate(socket: WebSocket, seatToken: string): Promise<SocketOutcome> {
  const outcome = socketOutcome(socket);
  socket.send(JSON.stringify({ type: 'auth', seatToken }));
  return outcome;
}

function expectGenericAuthClose(outcome: SocketOutcome, rawToken: string): void {
  expect(outcome).toEqual({ kind: 'close', code: 1008, reason: 'AUTH_FAILED' });
  if (outcome.kind === 'close') expect(outcome.reason).not.toContain(rawToken);
}

async function durableSnapshot(stub: MatchStub): Promise<{
  tokenRows: SqlRow[];
  deadlineRows: SqlRow[];
  attachments: unknown[];
}> {
  return runInDurableObject(stub, (_instance, state) => ({
    tokenRows: state.storage.sql.exec<SqlRow>(`SELECT * FROM match_seat_token`).toArray(),
    deadlineRows: state.storage.sql.exec<SqlRow>(`SELECT * FROM do_deadline`).toArray(),
    attachments: state.getWebSockets().map((socket) => socket.deserializeAttachment()),
  }));
}

describe('OLG-113 MatchDO seat authentication', () => {
  it('server-owned assignmentから30秒tokenを発行し、最初のframeでseatへ認証する', async () => {
    const id = matchId('happy');
    const stub = stubFor(id);
    const session = principal();

    await expect(stub.issueSeatToken(session)).resolves.toEqual({ state: 'not_assigned' });
    const issued = await assignAndIssue(stub, session);

    const stored = await durableSnapshot(stub);
    expect(stored.tokenRows).toHaveLength(1);
    expect(stored.deadlineRows).toHaveLength(0);
    expect(JSON.stringify(stored)).not.toContain(issued.seatToken);

    const socket = await openPlayerSocket(stub, id, session);
    const pending = await durableSnapshot(stub);
    expect(pending.deadlineRows).toHaveLength(1);
    expect(pending.attachments).toHaveLength(1);
    expect(pending.attachments[0]).toMatchObject({
      mode: 'pending',
      matchId: id,
      accountId: session.accountId,
      sessionId: session.sessionId,
      sessionVersion: session.sessionVersion,
    });
    expect(JSON.stringify(pending.attachments)).not.toContain(issued.seatToken);

    await expect(authenticate(socket, issued.seatToken)).resolves.toEqual({
      kind: 'message',
      data: 'auth_ok',
    });

    const authenticated = await durableSnapshot(stub);
    expect(authenticated.deadlineRows).toHaveLength(0);
    expect(authenticated.attachments).toHaveLength(1);
    expect(authenticated.attachments[0]).toMatchObject({
      mode: 'authenticated',
      matchId: id,
      seatId: 'player-1',
      assignmentVersion: issued.assignmentVersion,
      accountId: session.accountId,
      sessionId: session.sessionId,
      sessionVersion: session.sessionVersion,
    });
    expect(authenticated.tokenRows[0]?.consumed_at_ms).toEqual(expect.any(Number));
    expect(JSON.stringify(authenticated)).not.toContain(issued.seatToken);
    socket.close(1000, 'done');
  });

  it('seat再割当で旧authenticated socketを閉じ、旧assignmentVersionを使わせない', async () => {
    const id = matchId('reassignment');
    const stub = stubFor(id);
    const firstSession = principal();
    const issued = await assignAndIssue(stub, firstSession);
    const socket = await openPlayerSocket(stub, id, firstSession);
    await expect(authenticate(socket, issued.seatToken)).resolves.toEqual({
      kind: 'message',
      data: 'auth_ok',
    });

    const closed = socketOutcome(socket);
    const reassigned = await stub.assignSeat({
      ...principal(),
      seatId: 'player-1',
    });
    expect(reassigned).toEqual({
      state: 'assigned',
      seatId: 'player-1',
      assignmentVersion: issued.assignmentVersion + 1,
    });
    await expect(closed).resolves.toEqual({
      kind: 'close',
      code: 1008,
      reason: 'SEAT_REASSIGNED',
    });
  });

  it('別account/session/version/matchの接続を拒否し、正しい主体だけが消費できる', async () => {
    const id = matchId('binding');
    const stub = stubFor(id);
    const session = principal();
    const issued = await assignAndIssue(stub, session);
    const rejectedPrincipals = [
      { ...session, accountId: crypto.randomUUID() },
      { ...session, sessionId: crypto.randomUUID() },
      { ...session, sessionVersion: session.sessionVersion + 1 },
    ];

    for (const rejected of rejectedPrincipals) {
      const socket = await openPlayerSocket(stub, id, rejected);
      expectGenericAuthClose(await authenticate(socket, issued.seatToken), issued.seatToken);
    }

    const otherId = matchId('other-match');
    const otherSocket = await openPlayerSocket(stubFor(otherId), otherId, session);
    expectGenericAuthClose(
      await authenticate(otherSocket, issued.seatToken),
      issued.seatToken,
    );

    const validSocket = await openPlayerSocket(stub, id, session);
    await expect(authenticate(validSocket, issued.seatToken)).resolves.toEqual({
      kind: 'message',
      data: 'auth_ok',
    });
    validSocket.close(1000, 'done');
  });

  it('改変tokenを消費せず、正規tokenの再利用と期限切れを拒否する', async () => {
    const id = matchId('invalid-token');
    const stub = stubFor(id);
    const session = principal();
    const issued = await assignAndIssue(stub, session);
    const tampered = `${issued.seatToken[0] === 'A' ? 'B' : 'A'}${issued.seatToken.slice(1)}`;

    const tamperedSocket = await openPlayerSocket(stub, id, session);
    expectGenericAuthClose(await authenticate(tamperedSocket, tampered), tampered);

    const firstSocket = await openPlayerSocket(stub, id, session);
    await expect(authenticate(firstSocket, issued.seatToken)).resolves.toEqual({
      kind: 'message',
      data: 'auth_ok',
    });

    const reusedSocket = await openPlayerSocket(stub, id, session);
    expectGenericAuthClose(
      await authenticate(reusedSocket, issued.seatToken),
      issued.seatToken,
    );
    firstSocket.close(1000, 'done');

    const expired = await stub.issueSeatToken(session);
    expect(expired.state).toBe('issued');
    if (expired.state !== 'issued') throw new Error('Expected issued token');
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE match_seat_token
            SET expires_at_ms = issued_at_ms + 1
          WHERE consumed_at_ms IS NULL`,
      );
    });
    const expiredSocket = await openPlayerSocket(stub, id, session);
    expectGenericAuthClose(
      await authenticate(expiredSocket, expired.seatToken),
      expired.seatToken,
    );
  });

  it('同一tokenを2socketが並行consumeしても認証成功は1件だけになる', async () => {
    const id = matchId('parallel');
    const stub = stubFor(id);
    const session = principal();
    const issued = await assignAndIssue(stub, session);
    const first = await openPlayerSocket(stub, id, session);
    const second = await openPlayerSocket(stub, id, session);
    const firstOutcome = socketOutcome(first);
    const secondOutcome = socketOutcome(second);

    first.send(JSON.stringify({ type: 'auth', seatToken: issued.seatToken }));
    second.send(JSON.stringify({ type: 'auth', seatToken: issued.seatToken }));
    const outcomes = await Promise.all([firstOutcome, secondOutcome]);

    expect(outcomes.filter((outcome) => outcome.kind === 'message')).toEqual([
      { kind: 'message', data: 'auth_ok' },
    ]);
    expect(outcomes.filter((outcome) => outcome.kind === 'close')).toEqual([
      { kind: 'close', code: 1008, reason: 'AUTH_FAILED' },
    ]);
    expect(JSON.stringify(outcomes)).not.toContain(issued.seatToken);

    const snapshot = await durableSnapshot(stub);
    expect(
      snapshot.tokenRows.filter((row) => typeof row.consumed_at_ms === 'number'),
    ).toHaveLength(1);
    first.close(1000, 'done');
    second.close(1000, 'done');
  });

  it('同一assignmentへの発行がMAX_OUTSTANDING_SEAT_TOKENSに達するとrate_limitedになり、消費後に再発行できる', async () => {
    const id = matchId('rate-limited');
    const stub = stubFor(id);
    const session = principal();
    const assignment = await stub.assignSeat({ ...session, seatId: 'player-1' });
    expect(assignment.state).toBe('assigned');

    const issuedTokens: string[] = [];
    for (let i = 0; i < MAX_OUTSTANDING_SEAT_TOKENS; i += 1) {
      const issued = await stub.issueSeatToken(session);
      expect(issued.state).toBe('issued');
      if (issued.state !== 'issued') throw new Error('Expected issued seat token');
      issuedTokens.push(issued.seatToken);
    }
    expect(issuedTokens).toHaveLength(MAX_OUTSTANDING_SEAT_TOKENS);

    await expect(stub.issueSeatToken(session)).resolves.toEqual({ state: 'rate_limited' });

    const socket = await openPlayerSocket(stub, id, session);
    await expect(authenticate(socket, issuedTokens[0]!)).resolves.toEqual({
      kind: 'message',
      data: 'auth_ok',
    });
    socket.close(1000, 'done');

    await expect(stub.issueSeatToken(session)).resolves.toMatchObject({ state: 'issued' });
  });

  it('invalidate前のpendingと認証後socketを閉じ、旧versionの再発行を拒否する', async () => {
    const beforeId = matchId('invalidate-before');
    const beforeStub = stubFor(beforeId);
    const beforeSession = principal();
    await assignAndIssue(beforeStub, beforeSession);
    const pendingSocket = await openPlayerSocket(beforeStub, beforeId, beforeSession);
    const pendingClose = socketOutcome(pendingSocket);

    await expect(
      beforeStub.invalidateSession({
        sessionId: beforeSession.sessionId,
        invalidatedVersion: beforeSession.sessionVersion + 1,
      }),
    ).resolves.toEqual({ state: 'acknowledged', closedConnections: 1 });
    await expect(pendingClose).resolves.toEqual({
      kind: 'close',
      code: 1008,
      reason: 'SESSION_ENDED',
    });
    await expect(beforeStub.issueSeatToken(beforeSession)).resolves.toEqual({
      state: 'not_assigned',
    });

    const afterId = matchId('invalidate-after');
    const afterStub = stubFor(afterId);
    const afterSession = principal();
    const issued = await assignAndIssue(afterStub, afterSession, 'player-2');
    const authenticatedSocket = await openPlayerSocket(afterStub, afterId, afterSession);
    await expect(authenticate(authenticatedSocket, issued.seatToken)).resolves.toEqual({
      kind: 'message',
      data: 'auth_ok',
    });
    const authenticatedClose = socketOutcome(authenticatedSocket);

    await expect(
      afterStub.invalidateSession({
        sessionId: afterSession.sessionId,
        invalidatedVersion: afterSession.sessionVersion + 1,
      }),
    ).resolves.toEqual({ state: 'acknowledged', closedConnections: 1 });
    await expect(authenticatedClose).resolves.toEqual({
      kind: 'close',
      code: 1008,
      reason: 'SESSION_ENDED',
    });
  });

  it('session coordinatorが関連する全MatchDOのACKを待ち、socketを閉じる', async () => {
    const session = principal();
    const firstId = matchId('fanout-first');
    const secondId = matchId('fanout-second');
    const firstStub = stubFor(firstId);
    const secondStub = stubFor(secondId);
    const firstIssued = await assignAndIssue(firstStub, session, 'player-1');
    const secondIssued = await assignAndIssue(secondStub, session, 'player-2');
    const firstSocket = await openPlayerSocket(firstStub, firstId, session);
    const secondSocket = await openPlayerSocket(secondStub, secondId, session);
    await expect(authenticate(firstSocket, firstIssued.seatToken)).resolves.toEqual({
      kind: 'message',
      data: 'auth_ok',
    });
    await expect(authenticate(secondSocket, secondIssued.seatToken)).resolves.toEqual({
      kind: 'message',
      data: 'auth_ok',
    });
    const firstClose = socketOutcome(firstSocket);
    const secondClose = socketOutcome(secondSocket);

    await expect(
      coordinatorFor(session.sessionId).invalidateSession({
        sessionId: session.sessionId,
        invalidatedVersion: session.sessionVersion + 1,
      }),
    ).resolves.toEqual({
      state: 'acknowledged',
      invalidatedVersion: session.sessionVersion + 1,
      matchedObjects: 2,
    });
    await expect(Promise.all([firstClose, secondClose])).resolves.toEqual([
      { kind: 'close', code: 1008, reason: 'SESSION_ENDED' },
      { kind: 'close', code: 1008, reason: 'SESSION_ENDED' },
    ]);
    await expect(firstStub.issueSeatToken(session)).resolves.toEqual({
      state: 'not_assigned',
    });
    await expect(secondStub.issueSeatToken(session)).resolves.toEqual({
      state: 'not_assigned',
    });
  });

  it('logout失効がassignment登録より先でも旧sessionをMatchDOへ入れない', async () => {
    const session = principal();
    await coordinatorFor(session.sessionId).invalidateSession({
      sessionId: session.sessionId,
      invalidatedVersion: session.sessionVersion + 1,
    });
    const stub = stubFor(matchId('invalidation-race'));

    await expect(
      stub.assignSeat({ ...session, seatId: 'player-1' }),
    ).resolves.toEqual({ state: 'conflict' });
    await expect(stub.issueSeatToken(session)).resolves.toEqual({
      state: 'not_assigned',
    });
  });

  it('pending socketを休止復帰させても5秒deadlineのalarmで閉じる', async () => {
    const id = matchId('alarm');
    const stub = stubFor(id);
    const session = principal();
    const socket = await openPlayerSocket(stub, id, session);

    await runInDurableObject(stub, async (_instance, state) => {
      const serverSocket = state.getWebSockets()[0];
      if (!serverSocket) throw new Error('Expected pending server socket');
      const attachment = serverSocket.deserializeAttachment() as Record<string, unknown>;
      expect(attachment.mode).toBe('pending');
      expect(JSON.stringify(attachment)).not.toContain('seatToken');
      // 実時間5秒を待たず、同じ永続deadline/alarm経路を短い将来時刻へ圧縮する。
      const dueAt = Date.now() + 250;
      serverSocket.serializeAttachment({
        ...attachment,
        authDeadlineEpochMs: dueAt,
      });
      state.storage.sql.exec(`UPDATE do_deadline SET due_at_ms = ?`, dueAt);
      // runtimeの自動発火と競合させず、helperが休止復帰後のalarmを確実に起動する。
      await state.storage.setAlarm(Date.now() + 60_000);
    });

    let closedBeforeEviction = false;
    socket.addEventListener('close', () => {
      closedBeforeEviction = true;
    });
    const close = socketOutcome(socket);
    await evictDurableObject(stub);
    expect(closedBeforeEviction).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 300));
    // workerdが既にalarmを配送していればfalse、未配送ならここで即時配送する。
    await runDurableObjectAlarm(stub);
    await expect(close).resolves.toEqual({
      kind: 'close',
      code: 1008,
      reason: 'AUTH_FAILED',
    });
    const snapshot = await durableSnapshot(stub);
    expect(snapshot.deadlineRows).toHaveLength(0);
    expect(SEAT_AUTH_FRAME_TIMEOUT_MS).toBe(5_000);
  });

  it('無認証diagnosticはlocalの完全一致local-smokeだけに限定する', async () => {
    const diagnosticStub = stubFor('local-smoke');
    const accepted = await diagnosticStub.fetch(
      new Request('http://local.test/matches/local-smoke/ws', {
        headers: { Upgrade: 'websocket' },
      }),
    );
    expect(accepted.status).toBe(101);
    const diagnosticSocket = accepted.webSocket;
    if (!diagnosticSocket) throw new Error('Expected diagnostic WebSocket');
    diagnosticSocket.accept();
    const probe = socketOutcome(diagnosticSocket);
    diagnosticSocket.send('probe:exact');
    await expect(probe).resolves.toEqual({
      kind: 'message',
      data: 'probe_ack:local-smoke:exact',
    });
    diagnosticSocket.close(1000, 'done');

    const suffixId = 'local-smoke_1';
    const rejected = await stubFor(suffixId).fetch(
      new Request(`http://local.test/matches/${suffixId}/ws`, {
        headers: { Upgrade: 'websocket' },
      }),
    );
    expect(rejected.status).toBe(401);
    await expect(rejected.json()).resolves.toEqual({ error: 'SESSION_REQUIRED' });

    let nonLocalStubCalls = 0;
    const nonLocalHandler = createMatchAccessRequestHandler({
      publicPortEnabled: false,
      createStore: () => {
        throw new Error('Session store must not be reached');
      },
      matchStub: () => {
        nonLocalStubCalls += 1;
        return {
          issueSeatToken: async () => ({ state: 'not_assigned' as const }),
          fetch: async () => new Response(null, { status: 101 }),
        };
      },
    });
    const origin = 'https://play.example.com';
    const nonLocal = await nonLocalHandler(
      new Request(`${origin}/matches/local-smoke/ws`, {
        headers: {
          Origin: origin,
          'Sec-Fetch-Site': 'same-origin',
          Upgrade: 'websocket',
        },
      }),
      {
        APP_ENV: 'production',
        APP_ORIGIN: origin,
      } as MatchAccessBindings,
    );
    expect(nonLocal?.status).toBe(404);
    await expect(nonLocal?.json()).resolves.toEqual({ error: 'MATCH_NOT_AVAILABLE' });
    expect(nonLocalStubCalls).toBe(0);
  });

  it('DO identityと異なるmatch URLを同じstubへ転送しても拒否する', async () => {
    const boundId = matchId('identity-bound');
    const differentId = matchId('identity-different');
    const response = await stubFor(boundId).fetch(
      new Request(`http://local.test/matches/${differentId}/ws`, {
        headers: { Upgrade: 'websocket' },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_MATCH_PATH' });
    expect(response.webSocket).toBeNull();
  });

  it('任意のDO stubへlocal-smoke URLを送ってもdiagnosticへ昇格しない', async () => {
    const arbitraryId = matchId('diagnostic-spoof');
    const response = await stubFor(arbitraryId).fetch(
      new Request('http://local.test/matches/local-smoke/ws', {
        headers: { Upgrade: 'websocket' },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_MATCH_PATH' });
    expect(response.webSocket).toBeNull();
  });
});
