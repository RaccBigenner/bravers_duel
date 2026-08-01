import { env } from 'cloudflare:workers';
import {
  actingPlayer,
  legalActions,
  searchAi,
  type BattleAction,
  type BattleState,
} from '@bravers/engine';
import {
  parseMatchCommandId,
  parseMatchId,
  parseMatchRevision,
  type MatchCommandCandidate,
  type MatchCommandId,
} from '@bravers/protocol';
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
  HUMAN_PLAYER,
  matchActionFromEngineAction,
  type AuthoritativeBattleSnapshot,
} from '../src/battle/engineBattleAdapter';
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

interface TestPendingAttachment extends MatchSessionPrincipal {
  mode: 'pending';
  connectionId: string;
  authDeadlineEpochMs: number;
}

let matchSequence = 0;
let commandSequence = 0;

function matchId(label: string): string {
  matchSequence += 1;
  return `olg113-${label}-${matchSequence}-${crypto.randomUUID().slice(0, 8)}`;
}

function nextCommandId(): MatchCommandId {
  commandSequence += 1;
  const commandId = parseMatchCommandId(`cmd_${commandSequence.toString(16).padStart(32, '0')}`);
  if (!commandId) throw new Error('Expected valid test command ID');
  return commandId;
}

function npcCommand(
  matchIdValue: string,
  expectedRevisionValue: number,
  action: unknown,
  commandId = nextCommandId(),
): MatchCommandCandidate {
  const parsedMatchId = parseMatchId(matchIdValue);
  const expectedRevision = parseMatchRevision(expectedRevisionValue);
  if (!parsedMatchId || expectedRevision === null) {
    throw new Error('Expected valid test command metadata');
  }
  return {
    matchId: parsedMatchId,
    commandId,
    expectedRevision,
    action,
  };
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

async function reserveNpcBattle(session = principal()): Promise<{
  session: MatchSessionPrincipal;
  id: string;
  seed: number;
  stub: MatchStub;
  coordinator: SessionCoordinatorStub;
}> {
  const coordinator = coordinatorFor(session.sessionId);
  const reservation = await coordinator.reserveNpcMatch({
    sessionId: session.sessionId,
    accountId: session.accountId,
    sessionVersion: session.sessionVersion,
  });
  expect(reservation.state).toBe('reserved');
  if (reservation.state !== 'reserved') throw new Error('Expected NPC reservation');
  return {
    session,
    id: reservation.matchId,
    seed: reservation.seed,
    stub: stubFor(reservation.matchId),
    coordinator,
  };
}

async function startReservedNpcBattle(session = principal()) {
  const reserved = await reserveNpcBattle(session);
  await expect(
    reserved.stub.startNpcBattle({ principal: reserved.session, seed: reserved.seed }),
  ).resolves.toEqual({ state: 'ready', created: true });
  return reserved;
}

async function expectMatchInstanceError(
  stub: MatchStub,
  operation: (instance: MatchDO) => Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  const message = await runInDurableObject(stub, async (instance) => {
    try {
      await operation(instance as MatchDO);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(message).toContain(expectedCode);
}

function stableHumanAction(
  snapshot: unknown,
  engineAction: BattleAction,
) {
  // DurableObjectStubのRPC型はtupleを通常配列へ広げるため、server内部snapshotへ戻す。
  const authoritative = snapshot as AuthoritativeBattleSnapshot;
  return matchActionFromEngineAction(
    authoritative.state,
    authoritative.battleCards,
    HUMAN_PLAYER,
    engineAction,
  );
}

async function leaveFinishedRuntimeBeforeTerminalCommit(
  instance: MatchDO,
  session: MatchSessionPrincipal,
  matchIdValue: string,
): Promise<{
  currentStateHash: string;
  steps: unknown[];
  finalCommand: MatchCommandCandidate;
}> {
  const target = instance as unknown as {
    battleRuntime: {
      authoritativeSnapshot(): AuthoritativeBattleSnapshot;
    } | null;
    persistBattleTerminal: (...args: unknown[]) => Promise<unknown>;
    applyNpcBattleCommand: MatchDO['applyNpcBattleCommand'];
  };
  const originalPersist = target.persistBattleTerminal;
  const injectedError = 'INJECTED_TERMINAL_COMMIT_FAILURE';
  target.persistBattleTerminal = async () => {
    throw new Error(injectedError);
  };
  let errorMessage: string | null = null;
  let revision = 0;
  let finalCommand: MatchCommandCandidate | null = null;
  try {
    const human = searchAi({ keepHand: 2 });
    for (let safety = 0; safety < 1_000; safety += 1) {
      const runtime = target.battleRuntime;
      if (!runtime) throw new Error('Expected active battle runtime');
      const snapshot = runtime.authoritativeSnapshot();
      const command = npcCommand(
        matchIdValue,
        revision,
        stableHumanAction(snapshot, human.choose(snapshot.state, HUMAN_PLAYER)),
      );
      try {
        const result = await target.applyNpcBattleCommand({
          principal: session,
          command,
        });
        if (result.state !== 'accepted') throw new Error(result.errorCode);
        revision = result.revision;
      } catch (error) {
        finalCommand = command;
        errorMessage = error instanceof Error ? error.message : String(error);
        break;
      }
    }
  } finally {
    target.persistBattleTerminal = originalPersist;
  }
  if (errorMessage !== injectedError) {
    throw new Error(`Expected injected terminal failure, received: ${errorMessage}`);
  }
  if (!finalCommand) throw new Error('Expected final command fixture');
  const runtime = target.battleRuntime;
  if (!runtime) throw new Error('Expected finished in-memory battle runtime');
  const snapshot = runtime.authoritativeSnapshot();
  return {
    currentStateHash: snapshot.currentStateHash,
    steps: snapshot.steps,
    finalCommand,
  };
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

function pendingAttachment(
  state: DurableObjectState,
  sessionId: string,
): TestPendingAttachment {
  const attachments = state.getWebSockets().map(
    (socket) => socket.deserializeAttachment() as Partial<TestPendingAttachment> | null,
  );
  const attachment = attachments.find(
    (candidate) => candidate?.mode === 'pending' && candidate.sessionId === sessionId,
  );
  if (
    !attachment ||
    typeof attachment.connectionId !== 'string' ||
    !Number.isSafeInteger(attachment.authDeadlineEpochMs)
  ) {
    throw new Error('Expected pending attachment');
  }
  return attachment as TestPendingAttachment;
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

  it('同じassignmentの再送は永続registration IDを再利用して参照を増やさない', async () => {
    const id = matchId('assignment-idempotency');
    const stub = stubFor(id);
    const session = principal();
    const first = await stub.assignSeat({ ...session, seatId: 'player-1' });
    const second = await stub.assignSeat({ ...session, seatId: 'player-1' });
    expect(second).toEqual(first);

    const storedRegistrationId = await runInDurableObject(
      stub,
      (_instance, state) => state.storage.sql.exec<{ coordinator_registration_id: string }>(
        `SELECT coordinator_registration_id FROM match_seat_assignment WHERE seat_id = 'player-1'`,
      ).one().coordinator_registration_id,
    );
    const coordinatorValues = await runInDurableObject(
      coordinatorFor(session.sessionId),
      async (_instance, state) => [...(await state.storage.list()).values()],
    );
    const references = coordinatorValues.find(Array.isArray) as
      | Array<Record<string, unknown>>
      | undefined;
    expect(references?.filter((reference) => reference.matchId === id)).toEqual([
      expect.objectContaining({
        matchId: id,
        registrationId: storedRegistrationId,
      }),
    ]);
  });

  it('coordinatorの取消epochが進んでいてもfloor+1を永続して次の明示再送で回復する', async () => {
    const id = matchId('registration-epoch-recovery');
    const session = principal();
    const cancelledThroughEpochMs = Date.now() + 1_000;
    await coordinatorFor(session.sessionId).unregisterMatch({
      sessionId: session.sessionId,
      sessionVersion: session.sessionVersion,
      matchId: id,
      registrationId: crypto.randomUUID(),
      registrationEpochMs: cancelledThroughEpochMs,
    });
    const stub = stubFor(id);

    await expect(
      stub.assignSeat({ ...session, seatId: 'player-1' }),
    ).resolves.toEqual({ state: 'conflict' });
    await expect(
      stub.assignSeat({ ...session, seatId: 'player-1' }),
    ).resolves.toMatchObject({ state: 'assigned', seatId: 'player-1' });
    const activeEpoch = await runInDurableObject(
      stub,
      (_instance, state) => state.storage.sql.exec<{
        coordinator_registration_epoch_ms: number;
      }>(
        `SELECT coordinator_registration_epoch_ms
           FROM match_seat_assignment WHERE seat_id = 'player-1'`,
      ).one().coordinator_registration_epoch_ms,
    );
    expect(activeEpoch).toBeGreaterThan(cancelledThroughEpochMs);
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
    const secondSession = principal();
    const reassigned = await stub.assignSeat({
      ...secondSession,
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
    const [oldValues, newValues] = await Promise.all([
      runInDurableObject(
        coordinatorFor(firstSession.sessionId),
        async (_instance, state) => [...(await state.storage.list()).values()],
      ),
      runInDurableObject(
        coordinatorFor(secondSession.sessionId),
        async (_instance, state) => [...(await state.storage.list()).values()],
      ),
    ]);
    // 旧sessionの有効参照一覧からは消えているべき(取消floorがmatchIdをbookkeepingとして
    // 保持し続けるのは意図した挙動であり、storage全体から文字列が消えることとは別)。
    const oldActiveReferences = oldValues.find(Array.isArray) as
      | Array<Record<string, unknown>>
      | undefined;
    expect(oldActiveReferences?.some((reference) => reference.matchId === id)).toBe(false);
    const newActiveReferences = newValues.find(Array.isArray) as
      | Array<Record<string, unknown>>
      | undefined;
    expect(newActiveReferences?.some((reference) => reference.matchId === id)).toBe(true);
  });

  it('同じsession IDを別accountへ付け替えず、既存coordinator参照も保持する', async () => {
    const id = matchId('session-account-conflict');
    const stub = stubFor(id);
    const session = principal();
    await expect(
      stub.assignSeat({ ...session, seatId: 'player-1' }),
    ).resolves.toMatchObject({ state: 'assigned' });

    await expect(
      stub.assignSeat({
        ...session,
        accountId: crypto.randomUUID(),
        seatId: 'player-1',
      }),
    ).resolves.toEqual({ state: 'conflict' });
    await expect(stub.issueSeatToken(session)).resolves.toMatchObject({ state: 'issued' });
    const coordinatorValues = await runInDurableObject(
      coordinatorFor(session.sessionId),
      async (_instance, state) => [...(await state.storage.list()).values()],
    );
    expect(JSON.stringify(coordinatorValues)).toContain(id);
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

  it('active+retained候補で鍵更新前に発行したtokenを統合consumeできる', async () => {
    const id = matchId('retained-key');
    const stub = stubFor(id);
    const session = principal();
    const issued = await assignAndIssue(stub, session);
    const rotated = rotatedSeatTokenKeys();
    const candidates = await seatTokenDigestCandidates(issued.seatToken, rotated.keys);
    expect(candidates.map((candidate) => candidate.keyVersion)).toEqual([
      rotated.activeVersion,
      rotated.retainedVersion,
    ]);
    const socket = await openPlayerSocket(stub, id, session);

    const consumed = await runInDurableObject(stub, (instance, state) => {
      const attachment = pendingAttachment(state, session.sessionId);
      return (instance as MatchDO).consumeSeatTokenCandidates(candidates, session, {
        connectionId: attachment.connectionId,
        authDeadlineEpochMs: attachment.authDeadlineEpochMs,
      });
    });

    expect(consumed).toEqual({
      state: 'consumed',
      seatId: 'player-1',
      assignmentVersion: issued.assignmentVersion,
    });
    const snapshot = await durableSnapshot(stub);
    expect(snapshot.tokenRows).toHaveLength(1);
    expect(snapshot.tokenRows[0]?.digest_key_version).toBe(rotated.retainedVersion);
    expect(snapshot.tokenRows[0]?.consumed_at_ms).toEqual(expect.any(Number));
    socket.close(1000, 'done');
  });

  it('2候補がSQLite上で同時一致したambiguousではどちらも消費しない', async () => {
    const id = matchId('ambiguous-key');
    const stub = stubFor(id);
    const session = principal();
    const issued = await assignAndIssue(stub, session);
    const rotated = rotatedSeatTokenKeys();
    const candidates = await seatTokenDigestCandidates(issued.seatToken, rotated.keys);
    const active = candidates.find(
      (candidate) => candidate.keyVersion === rotated.activeVersion,
    );
    const retained = candidates.find(
      (candidate) => candidate.keyVersion === rotated.retainedVersion,
    );
    if (!active || !retained) throw new Error('Expected active and retained candidates');
    const socket = await openPlayerSocket(stub, id, session);

    const consumed = await runInDurableObject(stub, (instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO match_seat_token (
           token_digest, digest_key_version, seat_id, account_id, session_id,
           session_version, assignment_version, issued_at_ms, expires_at_ms, consumed_at_ms
         )
         SELECT ?, ?, seat_id, account_id, session_id, session_version,
                assignment_version, issued_at_ms, expires_at_ms, consumed_at_ms
           FROM match_seat_token
          WHERE token_digest = ? AND digest_key_version = ?`,
        active.digestHex,
        active.keyVersion,
        retained.digestHex,
        retained.keyVersion,
      );
      const attachment = pendingAttachment(state, session.sessionId);
      return (instance as MatchDO).consumeSeatTokenCandidates(candidates, session, {
        connectionId: attachment.connectionId,
        authDeadlineEpochMs: attachment.authDeadlineEpochMs,
      });
    });

    expect(consumed).toEqual({ state: 'ambiguous' });
    const snapshot = await durableSnapshot(stub);
    expect(snapshot.tokenRows).toHaveLength(2);
    expect(
      snapshot.tokenRows.every((row) => row.consumed_at_ms === null),
    ).toBe(true);
    expect(snapshot.tokenRows.map((row) => row.digest_key_version).sort()).toEqual([
      rotated.retainedVersion,
      rotated.activeVersion,
    ]);
    socket.close(1000, 'done');
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

  it('MatchDO側でassignment conflictになった新規参照をcoordinatorから解除する', async () => {
    const session = principal();
    const id = matchId('reference-cleanup');
    const stub = stubFor(id);
    await stub.invalidateSession({
      sessionId: session.sessionId,
      invalidatedVersion: session.sessionVersion + 1,
    });

    await expect(
      stub.assignSeat({ ...session, seatId: 'player-1' }),
    ).resolves.toEqual({ state: 'conflict' });
    const coordinatorValues = await runInDurableObject(
      coordinatorFor(session.sessionId),
      async (_instance, state) => [...(await state.storage.list()).values()],
    );
    expect(JSON.stringify(coordinatorValues)).not.toContain(id);
  });

  it('coordinator解除の応答喪失をSQLiteへ残し、新しいstubのalarm retryで回収する', async () => {
    const session = principal();
    const id = matchId('reference-cleanup-retry');
    const registrationId = crypto.randomUUID();
    const reference = {
      seatId: 'player-1' as const,
      accountId: session.accountId,
      sessionId: session.sessionId,
      sessionVersion: session.sessionVersion,
      matchId: id,
      registrationId,
      registrationEpochMs: Date.now(),
    };
    const coordinator = coordinatorFor(session.sessionId);
    await coordinator.registerMatch(reference);
    const stub = stubFor(id);

    await runInDurableObject(stub, async (instance, state) => {
      await (
        instance as unknown as {
          unregisterReference(input: typeof reference, target: unknown): Promise<void>;
        }
      ).unregisterReference(reference, {
        unregisterMatch: async () => {
          throw new Error('simulated response loss');
        },
      });
      expect(
        state.storage.sql.exec<SqlRow>(`SELECT * FROM match_reference_cleanup`).toArray(),
      ).toEqual([
        expect.objectContaining({ registration_id: registrationId, retry_attempt: 0 }),
      ]);
      expect(
        state.storage.sql.exec<SqlRow>(
          `SELECT deadline_kind FROM do_deadline WHERE deadline_key = ?`,
          `coordinator-cleanup:${registrationId}`,
        ).one(),
      ).toEqual({ deadline_kind: 'coordinator-cleanup' });
      expect(await state.storage.getAlarm()).toEqual(expect.any(Number));
      state.storage.sql.exec(
        `UPDATE do_deadline SET due_at_ms = ? WHERE deadline_key = ?`,
        Date.now() - 1,
        `coordinator-cleanup:${registrationId}`,
      );
      await state.storage.setAlarm(Date.now() + 60_000);
      await (instance as MatchDO).alarm();
    });

    const cleaned = await runInDurableObject(stub, (_instance, state) => ({
      cleanup: state.storage.sql.exec<SqlRow>(`SELECT * FROM match_reference_cleanup`).toArray(),
      deadlines: state.storage.sql.exec<SqlRow>(
        `SELECT * FROM do_deadline WHERE deadline_kind = 'coordinator-cleanup'`,
      ).toArray(),
    }));
    expect(cleaned).toEqual({ cleanup: [], deadlines: [] });
    await expect(coordinator.checkMatch(reference)).resolves.toEqual({ state: 'missing' });
    await expect(coordinator.registerMatch(reference)).resolves.toMatchObject({
      state: 'cancelled',
      cancelledThroughEpochMs: reference.registrationEpochMs,
    });
  });

  it('register応答前のpendingを永続化し、停止後alarmが孤児参照へ収束させる', async () => {
    const session = principal();
    const id = matchId('pending-registration-recovery');
    const reference = {
      seatId: 'player-1' as const,
      accountId: session.accountId,
      sessionId: session.sessionId,
      sessionVersion: session.sessionVersion,
      matchId: id,
      registrationId: crypto.randomUUID(),
      registrationEpochMs: Date.now(),
    };
    const coordinator = coordinatorFor(session.sessionId);
    await coordinator.registerMatch(reference);
    const stub = stubFor(id);

    await runInDurableObject(stub, async (instance, state) => {
      await (
        instance as unknown as {
          persistPendingReference(input: typeof reference): Promise<void>;
        }
      ).persistPendingReference(reference);
      expect(
        state.storage.sql.exec<SqlRow>(
          `SELECT work_kind FROM match_reference_cleanup WHERE registration_id = ?`,
          reference.registrationId,
        ).one(),
      ).toEqual({ work_kind: 'pending_assignment' });
      expect(await state.storage.getAlarm()).toEqual(expect.any(Number));
      state.storage.sql.exec(
        `UPDATE do_deadline SET due_at_ms = ? WHERE deadline_key = ?`,
        Date.now() - 1,
        `coordinator-cleanup:${reference.registrationId}`,
      );
      await state.storage.setAlarm(Date.now() + 60_000);
      await (instance as MatchDO).alarm();
    });

    await expect(coordinator.checkMatch(reference)).resolves.toEqual({ state: 'missing' });
    await expect(coordinator.registerMatch(reference)).resolves.toMatchObject({
      state: 'cancelled',
      cancelledThroughEpochMs: reference.registrationEpochMs,
    });
  });

  it('seat置換transaction内で新pendingをactive化し、旧ID cleanup outboxとalarmを残す', async () => {
    const id = matchId('replacement-outbox');
    const stub = stubFor(id);
    const first = principal();
    await stub.assignSeat({ ...first, seatId: 'player-1' });
    const oldRegistrationId = await runInDurableObject(
      stub,
      (_instance, state) => state.storage.sql.exec<{ coordinator_registration_id: string }>(
        `SELECT coordinator_registration_id FROM match_seat_assignment WHERE seat_id = 'player-1'`,
      ).one().coordinator_registration_id,
    );
    const second = principal();

    await runInDurableObject(stub, async (instance, state) => {
      const target = instance as unknown as {
        assignSeat(input: MatchSessionPrincipal & { seatId: MatchSeatId }): Promise<unknown>;
        unregisterReference(input: unknown): Promise<void>;
      };
      const unregister = target.unregisterReference.bind(instance);
      target.unregisterReference = async () => {};
      await expect(
        target.assignSeat({ ...second, seatId: 'player-1' }),
      ).resolves.toMatchObject({ state: 'assigned', seatId: 'player-1' });
      target.unregisterReference = unregister;

      expect(
        state.storage.sql.exec<SqlRow>(`SELECT * FROM match_reference_cleanup`).toArray(),
      ).toEqual([
        expect.objectContaining({
          registration_id: oldRegistrationId,
          seat_id: 'player-1',
          account_id: first.accountId,
          work_kind: 'cleanup',
        }),
      ]);
      expect(await state.storage.getAlarm()).toEqual(expect.any(Number));
      const active = state.storage.sql.exec<SqlRow>(
        `SELECT account_id, coordinator_registration_id
           FROM match_seat_assignment WHERE seat_id = 'player-1'`,
      ).one();
      expect(active.account_id).toBe(second.accountId);
      expect(active.coordinator_registration_id).not.toBe(oldRegistrationId);
    });
  });

  it('cleanup中のseatは次の置換をfail closedにし、alarmは1件ずつ処理する', async () => {
    const id = matchId('bounded-reference-work');
    const stub = stubFor(id);
    const first = principal();
    const second = principal();
    const works = [
      {
        seatId: 'player-1' as const,
        accountId: first.accountId,
        sessionId: first.sessionId,
        sessionVersion: first.sessionVersion,
        matchId: id,
        registrationId: crypto.randomUUID(),
        registrationEpochMs: Date.now(),
      },
      {
        seatId: 'player-2' as const,
        accountId: second.accountId,
        sessionId: second.sessionId,
        sessionVersion: second.sessionVersion,
        matchId: id,
        registrationId: crypto.randomUUID(),
        registrationEpochMs: Date.now(),
      },
    ];

    await runInDurableObject(stub, async (instance, state) => {
      const target = instance as unknown as {
        scheduleReferenceCleanup(input: (typeof works)[number]): Promise<void>;
        retryReferenceCleanup(deadlineKey: string): Promise<boolean>;
        assignSeat(input: MatchSessionPrincipal & { seatId: MatchSeatId }): Promise<unknown>;
      };
      await target.scheduleReferenceCleanup(works[0]!);
      await target.scheduleReferenceCleanup(works[1]!);
      state.storage.sql.exec(
        `UPDATE do_deadline SET due_at_ms = ? WHERE deadline_kind = 'coordinator-cleanup'`,
        Date.now() - 1,
      );
      await state.storage.setAlarm(Date.now() + 60_000);

      const retried: string[] = [];
      target.retryReferenceCleanup = async (deadlineKey) => {
        retried.push(deadlineKey);
        return false;
      };
      await (instance as MatchDO).alarm();
      expect(retried).toHaveLength(1);
      expect(await state.storage.getAlarm()).toEqual(expect.any(Number));
      await expect(
        target.assignSeat({ ...principal(), seatId: 'player-1' }),
      ).resolves.toEqual({ state: 'conflict' });
      expect(
        state.storage.sql.exec<{ count: number }>(
          `SELECT COUNT(*) AS count FROM match_reference_cleanup`,
        ).one().count,
      ).toBe(2);
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

  it('複数pendingでは早いalarmを後発が遅らせず、同じalarmの二重実行も冪等', async () => {
    const id = matchId('multiple-alarms');
    const stub = stubFor(id);
    const firstSession = principal();
    const secondSession = principal();
    const firstSocket = await openPlayerSocket(stub, id, firstSession);
    const firstState = await runInDurableObject(stub, async (_instance, state) => {
      const attachment = pendingAttachment(state, firstSession.sessionId);
      return {
        attachment,
        alarm: await state.storage.getAlarm(),
      };
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const secondSocket = await openPlayerSocket(stub, id, secondSession);
    const secondState = await runInDurableObject(stub, async (_instance, state) => ({
      attachment: pendingAttachment(state, secondSession.sessionId),
      alarm: await state.storage.getAlarm(),
    }));

    expect(secondState.attachment.authDeadlineEpochMs).toBeGreaterThan(
      firstState.attachment.authDeadlineEpochMs,
    );
    expect(firstState.alarm).toBe(firstState.attachment.authDeadlineEpochMs);
    expect(secondState.alarm).toBe(firstState.alarm);

    const earlyDueAt = Date.now() + 150;
    const lateDueAt = earlyDueAt + 60_000;
    await runInDurableObject(stub, async (_instance, state) => {
      for (const serverSocket of state.getWebSockets()) {
        const attachment = serverSocket.deserializeAttachment() as
          | TestPendingAttachment
          | null;
        if (attachment?.mode !== 'pending') continue;
        const dueAt = attachment.sessionId === firstSession.sessionId
          ? earlyDueAt
          : lateDueAt;
        serverSocket.serializeAttachment({
          ...attachment,
          authDeadlineEpochMs: dueAt,
        });
        state.storage.sql.exec(
          `UPDATE do_deadline SET due_at_ms = ? WHERE deadline_key = ?`,
          dueAt,
          `ws-auth:${attachment.connectionId}`,
        );
      }
      // 自動配送との競合を避け、下で同じalarm handlerを明示的に二重実行する。
      await state.storage.setAlarm(lateDueAt + 60_000);
    });

    const firstClose = socketOutcome(firstSocket);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await runInDurableObject(stub, (instance) => (instance as MatchDO).alarm());
    await expect(firstClose).resolves.toEqual({
      kind: 'close',
      code: 1008,
      reason: 'AUTH_FAILED',
    });
    await runInDurableObject(stub, (instance) => (instance as MatchDO).alarm());

    const remaining = await runInDurableObject(stub, async (_instance, state) => ({
      deadlines: state.storage.sql.exec<SqlRow>(
        `SELECT deadline_key, due_at_ms FROM do_deadline`,
      ).toArray(),
      secondAttachment: pendingAttachment(state, secondSession.sessionId),
      alarm: await state.storage.getAlarm(),
    }));
    expect(remaining.deadlines).toEqual([
      {
        deadline_key: `ws-auth:${secondState.attachment.connectionId}`,
        due_at_ms: lateDueAt,
      },
    ]);
    expect(remaining.secondAttachment.authDeadlineEpochMs).toBe(lateDueAt);
    expect(remaining.alarm).toBe(lateDueAt);
    expect(secondSocket.readyState).toBe(WebSocket.OPEN);
    secondSocket.close(1000, 'done');
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
      coordinatorStub: () => {
        throw new Error('Session coordinator must not be reached');
      },
      matchStub: () => {
        nonLocalStubCalls += 1;
        return {
          issueSeatToken: async () => ({ state: 'not_assigned' as const }),
          startNpcBattle: async () => ({ state: 'unavailable' as const }),
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

describe('OLG-121 MatchDO authoritative NPC battle lifecycle', () => {
  it('server生成identityだけで開始し、exact再送を同じruntimeへ収束させる', async () => {
    const battle = await startReservedNpcBattle();

    await expect(
      battle.stub.startNpcBattle({ principal: battle.session, seed: battle.seed }),
    ).resolves.toEqual({ state: 'ready', created: false });
    const lifecycle = await battle.stub.getNpcBattleLifecycle(battle.session);
    expect(lifecycle).toMatchObject({
      matchId: battle.id,
      state: 'active',
      principal: battle.session,
      seatId: 'player-1',
      seed: battle.seed,
      terminalResult: null,
    });
    expect(lifecycle.assignmentVersion).toBeGreaterThanOrEqual(1);
    const snapshot = await battle.stub.getNpcBattleSnapshot(battle.session);
    expect(snapshot.header.seed).toBe(battle.seed);
    expect(snapshot.header.humanPlayer).toBe(HUMAN_PLAYER);

    await expect(
      battle.stub.startNpcBattle({ principal: battle.session, seed: (battle.seed + 1) >>> 0 }),
    ).resolves.toEqual({ state: 'conflict' });
    await expect(
      battle.stub.startNpcBattle({ principal: principal(), seed: battle.seed }),
    ).resolves.toEqual({ state: 'conflict' });
    await expectMatchInstanceError(
      battle.stub,
      (instance) => instance.startNpcBattle({
        principal: { ...battle.session, credentialState: 'spoof' } as never,
        seed: battle.seed,
      }),
      'MATCH_BATTLE_INPUT_INVALID',
    );
    const invalidIdentity = stubFor('npc-client-chosen');
    await expectMatchInstanceError(
      invalidIdentity,
      (instance) => instance.startNpcBattle({
        principal: battle.session,
        seed: battle.seed,
      }),
      'MATCH_BATTLE_INPUT_INVALID',
    );
  });

  it('startNpcBattle前のstate RPCはMATCH_BATTLE_NOT_STARTEDで拒否する', async () => {
    const reserved = await reserveNpcBattle();

    await expectMatchInstanceError(
      reserved.stub,
      (instance) => instance.getNpcBattleLifecycle(reserved.session),
      'MATCH_BATTLE_NOT_STARTED',
    );
    await expectMatchInstanceError(
      reserved.stub,
      (instance) => instance.getNpcBattleSnapshot(reserved.session),
      'MATCH_BATTLE_NOT_STARTED',
    );
    await expectMatchInstanceError(
      reserved.stub,
      (instance) => instance.getNpcBattleResult(reserved.session),
      'MATCH_BATTLE_NOT_STARTED',
    );
  });

  it('改変actionを盤面不変で拒否し、合法actionだけをNPC応答まで適用する', async () => {
    const battle = await startReservedNpcBattle();
    const before = await battle.stub.getNpcBattleSnapshot(battle.session);
    expect(actingPlayer(before.state as BattleState)).toBe(HUMAN_PLAYER);
    const engineAction = searchAi({ keepHand: 2 }).choose(
      before.state as BattleState,
      HUMAN_PLAYER,
    );
    const action = stableHumanAction(before, engineAction);

    await expect(
      battle.stub.applyNpcBattleCommand({
        principal: battle.session,
        command: npcCommand(battle.id, 0, { ...action, browserInjected: true }),
      }),
    ).resolves.toMatchObject({
      state: 'rejected',
      errorCode: 'MATCH_ACTION_INVALID',
      revision: 0,
    });
    await expect(battle.stub.getNpcBattleSnapshot(battle.session)).resolves.toEqual(before);

    const applied = await battle.stub.applyNpcBattleCommand({
      principal: battle.session,
      command: npcCommand(battle.id, 0, action),
    });
    expect(applied.state).toBe('accepted');
    if (applied.state !== 'accepted') throw new Error(applied.errorCode);
    expect(applied.revision).toBe(1);
    expect('transition' in applied).toBe(false);
    expect('lifecycleState' in applied).toBe(false);
    const after = await battle.stub.getNpcBattleSnapshot(battle.session);
    expect(after.steps.slice(before.steps.length)[0]).toMatchObject({
      player: HUMAN_PLAYER,
      source: 'human',
    });
    expect(after.currentStateHash).not.toBe(before.currentStateHash);
  });

  it('battleCardIdを現在手札だけから解決し、index移動後も同じ個体へ当てる', async () => {
    const battle = await startReservedNpcBattle();
    const endedPlay = await battle.stub.applyNpcBattleCommand({
      principal: battle.session,
      command: npcCommand(battle.id, 0, { type: 'endPlay' }),
    });
    expect(endedPlay.state).toBe('accepted');
    const chargeSnapshot = await battle.stub.getNpcBattleSnapshot(battle.session);
    const chargeActions = legalActions(chargeSnapshot.state as BattleState).filter(
      (action): action is Extract<BattleAction, { type: 'charge' }> => action.type === 'charge',
    );
    expect(chargeActions.length).toBeGreaterThan(1);
    const first = stableHumanAction(chargeSnapshot, chargeActions[0]!);
    const last = stableHumanAction(chargeSnapshot, chargeActions.at(-1)!);
    if (first.type !== 'charge' || last.type !== 'charge') {
      throw new Error('Expected stable charge actions');
    }
    const lastPrintingId = chargeSnapshot.battleCards.players[HUMAN_PLAYER].hand.at(-1)?.printingId;
    const opponentHandId = chargeSnapshot.battleCards.players[1].hand[0]?.battleCardId;
    const ownDeckId = chargeSnapshot.battleCards.players[HUMAN_PLAYER].deck[0]?.battleCardId;
    if (!lastPrintingId || !opponentHandId || !ownDeckId) {
      throw new Error('Expected hand and deck battleCardIds');
    }

    const rejectedActions: unknown[] = [
      chargeActions[0],
      { ...first, handIndex: 0 },
      { ...first, battleCardId: 'bc_ffffffffffffffffffffffffffffffff' },
      { ...first, battleCardId: opponentHandId },
      { ...first, battleCardId: ownDeckId },
    ];
    for (const action of rejectedActions) {
      await expect(
        battle.stub.applyNpcBattleCommand({
          principal: battle.session,
          command: npcCommand(battle.id, 1, action),
        }),
      ).resolves.toMatchObject({
        state: 'rejected',
        errorCode: 'MATCH_ACTION_INVALID',
        revision: 1,
      });
      await expect(battle.stub.getNpcBattleSnapshot(battle.session)).resolves.toEqual(
        chargeSnapshot,
      );
    }

    const firstApplied = await battle.stub.applyNpcBattleCommand({
      principal: battle.session,
      command: npcCommand(battle.id, 1, first),
    });
    expect(firstApplied).toMatchObject({ state: 'accepted', revision: 2 });
    const shifted = await battle.stub.getNpcBattleSnapshot(battle.session);
    const shiftedLast = shifted.battleCards.players[HUMAN_PLAYER].hand.find(
      (card) => card.battleCardId === last.battleCardId,
    );
    expect(shiftedLast?.printingId).toBe(lastPrintingId);

    const lastApplied = await battle.stub.applyNpcBattleCommand({
      principal: battle.session,
      command: npcCommand(battle.id, 2, last),
    });
    expect(lastApplied).toMatchObject({ state: 'accepted', revision: 3 });
    const after = await battle.stub.getNpcBattleSnapshot(battle.session);
    expect(
      after.battleCards.players[HUMAN_PLAYER].ap.find(
        (card) => card.battleCardId === last.battleCardId,
      )?.printingId,
    ).toBe(lastPrintingId);

    await expect(
      battle.stub.applyNpcBattleCommand({
        principal: battle.session,
        command: npcCommand(battle.id, 3, last),
      }),
    ).resolves.toMatchObject({
      state: 'rejected',
      errorCode: 'MATCH_ACTION_INVALID',
      revision: 3,
    });
    await expect(battle.stub.getNpcBattleSnapshot(battle.session)).resolves.toEqual(after);
  });

  it('NPC戦を最後まで進め、engine結果を先に永続化してassignmentと予約を解除する', async () => {
    const battle = await startReservedNpcBattle();
    const human = searchAi({ keepHand: 2 });
    let finalReceipt: Extract<
      Awaited<ReturnType<MatchDO['applyNpcBattleCommand']>>,
      { state: 'accepted' }
    > | null = null;
    let finalCommand: MatchCommandCandidate | null = null;
    let result: Awaited<ReturnType<MatchDO['getNpcBattleResult']>> = null;
    let revision = 0;

    for (let safety = 0; safety < 1_000; safety += 1) {
      const snapshot = await battle.stub.getNpcBattleSnapshot(battle.session);
      expect(actingPlayer(snapshot.state as BattleState)).toBe(HUMAN_PLAYER);
      const engineAction = human.choose(snapshot.state as BattleState, HUMAN_PLAYER);
      const command = npcCommand(
        battle.id,
        revision,
        stableHumanAction(snapshot, engineAction),
      );
      const applied = await battle.stub.applyNpcBattleCommand({
        principal: battle.session,
        command,
      });
      if (applied.state !== 'accepted') throw new Error(applied.errorCode);
      revision = applied.revision;
      result = await battle.stub.getNpcBattleResult(battle.session);
      if (result) {
        finalReceipt = applied;
        finalCommand = command;
        break;
      }
    }
    if (!finalReceipt || !finalCommand || !result || result.kind !== 'finished') {
      throw new Error('NPC battle did not finish');
    }

    expect(result.endReason).toMatch(/^(wipeout|deckout)$/);
    expect(finalReceipt).toMatchObject({
      state: 'accepted',
      baseRevision: finalReceipt.revision - 1,
      revision,
    });
    expect('transition' in finalReceipt).toBe(false);
    const durable = await runInDurableObject(battle.stub, (_instance, state) => ({
      lifecycle: state.storage.sql.exec<SqlRow>(
        `SELECT lifecycle_state, final_state_hash FROM match_battle_lifecycle`,
      ).one(),
      assignments: state.storage.sql.exec<SqlRow>(`SELECT * FROM match_seat_assignment`).toArray(),
      tokens: state.storage.sql.exec<SqlRow>(`SELECT * FROM match_seat_token`).toArray(),
      terminalRelease: state.storage.sql.exec<SqlRow>(
        `SELECT * FROM match_terminal_release`,
      ).toArray(),
    }));
    expect(durable).toEqual({
      lifecycle: {
        lifecycle_state: 'finished',
        final_state_hash: result.finalStateHash,
      },
      assignments: [],
      tokens: [],
      terminalRelease: [],
    });

    await expect(
      battle.stub.applyNpcBattleCommand({ principal: battle.session, command: finalCommand }),
    ).resolves.toEqual(finalReceipt);
    await expect(
      battle.stub.applyNpcBattleCommand({
        principal: battle.session,
        command: npcCommand(battle.id, finalReceipt.revision, { type: 'endPlay' }),
      }),
    ).resolves.toMatchObject({
      state: 'rejected',
      errorCode: 'MATCH_ALREADY_TERMINAL',
      revision: finalReceipt.revision,
    });
    await expect(
      battle.stub.applyNpcBattleCommand({
        principal: battle.session,
        command: npcCommand(battle.id, finalReceipt.baseRevision, { type: 'endPlay' }),
      }),
    ).resolves.toMatchObject({
      state: 'rejected',
      errorCode: 'MATCH_REVISION_MISMATCH',
      relation: 'stale',
      revision: finalReceipt.revision,
    });
    await expect(
      battle.stub.applyNpcBattleCommand({
        principal: battle.session,
        command: npcCommand(
          battle.id,
          finalReceipt.revision,
          finalCommand.action,
          finalCommand.commandId,
        ),
      }),
    ).resolves.toMatchObject({
      state: 'rejected',
      errorCode: 'MATCH_COMMAND_ID_CONFLICT',
      originalRevision: finalReceipt.revision,
    });

    const next = await battle.coordinator.reserveNpcMatch({
      sessionId: battle.session.sessionId,
      accountId: battle.session.accountId,
      sessionVersion: battle.session.sessionVersion,
    });
    expect(next).toMatchObject({ state: 'reserved', created: true });
    if (next.state === 'reserved') expect(next.matchId).not.toBe(battle.id);
  }, 20_000);

  it('active DO eviction後はseedから再生成せず全state RPCをfail closedにする', async () => {
    const battle = await startReservedNpcBattle();
    await battle.stub.getNpcBattleSnapshot(battle.session);
    await evictDurableObject(battle.stub);

    await expect(
      battle.stub.startNpcBattle({ principal: battle.session, seed: battle.seed }),
    ).resolves.toEqual({ state: 'unavailable' });
    await expectMatchInstanceError(
      battle.stub,
      (instance) => instance.getNpcBattleSnapshot(battle.session),
      'MATCH_STATE_UNAVAILABLE',
    );
    await expectMatchInstanceError(
      battle.stub,
      (instance) => instance.getNpcBattleLifecycle(battle.session),
      'MATCH_STATE_UNAVAILABLE',
    );
    await expectMatchInstanceError(
      battle.stub,
      (instance) => instance.getNpcBattleResult(battle.session),
      'MATCH_STATE_UNAVAILABLE',
    );
    await expectMatchInstanceError(
      battle.stub,
      (instance) => instance.applyNpcBattleCommand({
        principal: battle.session,
        command: npcCommand(battle.id, 0, { type: 'endPlay' }),
      }),
      'MATCH_STATE_UNAVAILABLE',
    );

    const durable = await runInDurableObject(battle.stub, (_instance, state) => ({
      lifecycle: state.storage.sql.exec<SqlRow>(
        `SELECT lifecycle_state, seed FROM match_battle_lifecycle`,
      ).one(),
      assignmentCount: state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM match_seat_assignment`,
      ).one().count,
      terminalCount: state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM match_terminal_release`,
      ).one().count,
    }));
    expect(durable).toEqual({
      lifecycle: { lifecycle_state: 'active', seed: battle.seed },
      assignmentCount: 1,
      terminalCount: 0,
    });
  });

  it('terminal永続化後のDO evictionでもlifecycleとresultを復元する', async () => {
    const battle = await startReservedNpcBattle();
    const terminal = await battle.stub.abandonNpcBattle({
      principal: battle.session,
      reason: 'player_abandoned',
    });
    expect(terminal.state).toBe('abandoned');
    expect(terminal.terminalResult).toMatchObject({
      kind: 'abandoned',
      reason: 'player_abandoned',
      winner: 1,
    });

    await evictDurableObject(battle.stub);

    await expect(battle.stub.getNpcBattleLifecycle(battle.session)).resolves.toEqual(terminal);
    await expect(battle.stub.getNpcBattleResult(battle.session)).resolves.toEqual(
      terminal.terminalResult,
    );
    await expect(
      battle.stub.startNpcBattle({ principal: battle.session, seed: battle.seed }),
    ).resolves.toEqual({ state: 'conflict' });
    await expectMatchInstanceError(
      battle.stub,
      (instance) => instance.getNpcBattleSnapshot(battle.session),
      'MATCH_BATTLE_ALREADY_TERMINAL',
    );
  });

  it('認証済みWSのgame frameをwireへ通さずauthoritative stateを不変に保つ', async () => {
    const battle = await startReservedNpcBattle();
    const issued = await battle.stub.issueSeatToken(battle.session);
    expect(issued.state).toBe('issued');
    if (issued.state !== 'issued') throw new Error('Expected issued seat token');
    const socket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    await expect(authenticate(socket, issued.seatToken)).resolves.toEqual({
      kind: 'message',
      data: 'auth_ok',
    });
    const before = await battle.stub.getNpcBattleSnapshot(battle.session);

    const ownBattleCardId = before.battleCards.players[HUMAN_PLAYER].hand[0]?.battleCardId;
    if (!ownBattleCardId) throw new Error('Expected own hand battleCardId');
    for (const frame of [
      { type: 'action', action: { type: 'charge', handIndex: 0 } },
      { type: 'action', action: { type: 'charge', battleCardId: ownBattleCardId } },
    ]) {
      const rejected = socketOutcome(socket);
      socket.send(JSON.stringify(frame));
      await expect(rejected).resolves.toEqual({
        kind: 'message',
        data: 'error:game-not-ready',
      });
    }

    const after = await battle.stub.getNpcBattleSnapshot(battle.session);
    expect(after).toEqual(before);
    socket.close(1000, 'done');
  });

  it('session失効後はsocketを閉じ、exact startとbattle commandを盤面不変で拒否する', async () => {
    const battle = await startReservedNpcBattle();
    const issued = await battle.stub.issueSeatToken(battle.session);
    expect(issued.state).toBe('issued');
    if (issued.state !== 'issued') throw new Error('Expected issued seat token');
    const socket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    await expect(authenticate(socket, issued.seatToken)).resolves.toEqual({
      kind: 'message',
      data: 'auth_ok',
    });
    const before = await battle.stub.getNpcBattleSnapshot(battle.session);
    const engineAction = searchAi({ keepHand: 2 }).choose(
      before.state as BattleState,
      HUMAN_PLAYER,
    );
    const action = stableHumanAction(before, engineAction);
    const closed = socketOutcome(socket);

    await expect(battle.stub.invalidateSession({
      sessionId: battle.session.sessionId,
      invalidatedVersion: battle.session.sessionVersion + 1,
    })).resolves.toEqual({ state: 'acknowledged', closedConnections: 1 });
    await expect(closed).resolves.toEqual({
      kind: 'close',
      code: 1008,
      reason: 'SESSION_ENDED',
    });
    await expect(battle.stub.issueSeatToken(battle.session)).resolves.toEqual({
      state: 'not_assigned',
    });
    await expect(
      battle.stub.startNpcBattle({ principal: battle.session, seed: battle.seed }),
    ).resolves.toEqual({ state: 'conflict' });

    const rejected = await runInDurableObject(battle.stub, async (instance) => {
      let errorMessage: string | null = null;
      try {
        await (instance as MatchDO).applyNpcBattleCommand({
          principal: battle.session,
          command: npcCommand(battle.id, 0, action),
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      const runtime = (
        instance as unknown as {
          battleRuntime: {
            authoritativeSnapshot(): { currentStateHash: string; steps: unknown[] };
          } | null;
        }
      ).battleRuntime;
      if (!runtime) throw new Error('Expected active battle runtime');
      const after = runtime.authoritativeSnapshot();
      return {
        errorMessage,
        currentStateHash: after.currentStateHash,
        steps: after.steps,
      };
    });
    expect(rejected).toEqual({
      errorMessage: 'MATCH_BATTLE_ACCESS_DENIED',
      currentStateHash: before.currentStateHash,
      steps: before.steps,
    });
  });

  it('engine終了後のterminal commit失敗をexact start再送でfinishedへ収束させる', async () => {
    const battle = await startReservedNpcBattle();
    const recovered = await runInDurableObject(battle.stub, async (instance, state) => {
      const finished = await leaveFinishedRuntimeBeforeTerminalCommit(
        instance as MatchDO,
        battle.session,
        battle.id,
      );
      const restart = await (instance as MatchDO).startNpcBattle({
        principal: battle.session,
        seed: battle.seed,
      });
      const lifecycle = await (instance as MatchDO).getNpcBattleLifecycle(battle.session);
      const row = state.storage.sql.exec<SqlRow>(
        `SELECT * FROM match_battle_lifecycle`,
      ).one();
      let tamperedRowError: string | null = null;
      try {
        (
          instance as unknown as {
            lifecycleFromRow(row: unknown): unknown;
          }
        ).lifecycleFromRow({ ...row, terminal_reason: 'server_cancelled' });
      } catch (error) {
        tamperedRowError = error instanceof Error ? error.message : String(error);
      }
      return { finished, restart, lifecycle, tamperedRowError };
    });

    expect(recovered.restart).toEqual({ state: 'conflict' });
    expect(recovered.tamperedRowError).toBe('MATCH_BATTLE_STATE_INVALID');
    expect(recovered.lifecycle).toMatchObject({
      state: 'finished',
      terminalResult: {
        kind: 'finished',
        finalStateHash: recovered.finished.currentStateHash,
      },
    });
  }, 20_000);

  it('engine終了後のterminal commit失敗でもcancelで勝敗を上書きしない', async () => {
    const battle = await startReservedNpcBattle();
    const recovered = await runInDurableObject(battle.stub, async (instance) => {
      const finished = await leaveFinishedRuntimeBeforeTerminalCommit(
        instance as MatchDO,
        battle.session,
        battle.id,
      );
      let cancelError: string | null = null;
      try {
        await (instance as MatchDO).cancelNpcBattle({
          principal: battle.session,
          reason: 'server_cancelled',
        });
      } catch (error) {
        cancelError = error instanceof Error ? error.message : String(error);
      }
      const lifecycle = await (instance as MatchDO).getNpcBattleLifecycle(battle.session);
      return { cancelError, finished, lifecycle };
    });

    expect(recovered.cancelError).toBe('MATCH_BATTLE_ALREADY_TERMINAL');
    expect(recovered.lifecycle).toMatchObject({
      state: 'finished',
      terminalResult: {
        kind: 'finished',
        finalStateHash: recovered.finished.currentStateHash,
      },
    });
  }, 20_000);

  it('cancelとabandonを別の終端理由で永続化し、exact再送だけ冪等にする', async () => {
    const cancelled = await startReservedNpcBattle();
    const firstCancel = await cancelled.stub.cancelNpcBattle({
      principal: cancelled.session,
      reason: 'server_cancelled',
    });
    expect(firstCancel.state).toBe('cancelled');
    expect(firstCancel.terminalResult).toMatchObject({
      kind: 'cancelled',
      reason: 'server_cancelled',
      winner: null,
    });
    await expect(
      cancelled.stub.cancelNpcBattle({
        principal: cancelled.session,
        reason: 'server_cancelled',
      }),
    ).resolves.toEqual(firstCancel);
    await expectMatchInstanceError(
      cancelled.stub,
      (instance) => instance.cancelNpcBattle({
        principal: cancelled.session,
        reason: 'start_failed',
      }),
      'MATCH_BATTLE_ALREADY_TERMINAL',
    );

    const abandoned = await startReservedNpcBattle();
    const firstAbandon = await abandoned.stub.abandonNpcBattle({
      principal: abandoned.session,
      reason: 'player_abandoned',
    });
    expect(firstAbandon.state).toBe('abandoned');
    expect(firstAbandon.terminalResult).toMatchObject({
      kind: 'abandoned',
      reason: 'player_abandoned',
      winner: 1,
    });
    await expect(
      abandoned.stub.abandonNpcBattle({
        principal: abandoned.session,
        reason: 'player_abandoned',
      }),
    ).resolves.toEqual(firstAbandon);
  });

  it('assignmentを作れないprovisioning取消でもreservation-only outboxで予約を解放する', async () => {
    const session = principal();
    const coordinator = coordinatorFor(session.sessionId);
    const baseEpoch = Date.now();
    for (let index = 0; index < 16; index += 1) {
      await coordinator.registerMatch({
        sessionId: session.sessionId,
        sessionVersion: session.sessionVersion,
        matchId: `capacity-${index}`,
        registrationId: crypto.randomUUID(),
        registrationEpochMs: baseEpoch + index,
      });
    }
    const reserved = await reserveNpcBattle(session);
    await expect(
      reserved.stub.startNpcBattle({ principal: session, seed: reserved.seed }),
    ).resolves.toEqual({ state: 'conflict' });
    const beforeCancel = await runInDurableObject(reserved.stub, (_instance, state) => ({
      lifecycle: state.storage.sql.exec<SqlRow>(
        `SELECT lifecycle_state FROM match_battle_lifecycle`,
      ).one(),
      assignments: state.storage.sql.exec<SqlRow>(`SELECT * FROM match_seat_assignment`).toArray(),
    }));
    expect(beforeCancel).toEqual({
      lifecycle: { lifecycle_state: 'provisioning' },
      assignments: [],
    });

    const cancelled = await reserved.stub.cancelNpcBattle({
      principal: session,
      reason: 'start_failed',
    });
    expect(cancelled.terminalResult).toEqual({
      kind: 'cancelled',
      winner: null,
      reason: 'start_failed',
      turns: null,
      finalStateHash: null,
      appliedActions: null,
    });
    const outbox = await runInDurableObject(
      reserved.stub,
      (_instance, state) => state.storage.sql.exec<SqlRow>(
        `SELECT * FROM match_terminal_release`,
      ).toArray(),
    );
    expect(outbox).toEqual([]);
    const next = await coordinator.reserveNpcMatch({
      sessionId: session.sessionId,
      accountId: session.accountId,
      sessionVersion: session.sessionVersion,
    });
    expect(next).toMatchObject({ state: 'reserved', created: true });
    if (next.state === 'reserved') expect(next.matchId).not.toBe(reserved.id);
  });

  it('旧seat cleanup ACK喪失中でも別表outboxで新assignmentを安全に終端できる', async () => {
    const battle = await startReservedNpcBattle();
    const old = principal();
    const oldReference = {
      seatId: 'player-1' as const,
      accountId: old.accountId,
      sessionId: old.sessionId,
      sessionVersion: old.sessionVersion,
      matchId: battle.id,
      registrationId: crypto.randomUUID(),
      registrationEpochMs: Date.now(),
    };
    await coordinatorFor(old.sessionId).registerMatch(oldReference);
    await runInDurableObject(battle.stub, async (instance) => {
      await (
        instance as unknown as {
          scheduleReferenceCleanup(input: typeof oldReference): Promise<void>;
        }
      ).scheduleReferenceCleanup(oldReference);
    });

    await expect(
      battle.stub.cancelNpcBattle({
        principal: battle.session,
        reason: 'server_cancelled',
      }),
    ).resolves.toMatchObject({ state: 'cancelled' });
    const coexistence = await runInDurableObject(battle.stub, (_instance, state) => ({
      oldCleanup: state.storage.sql.exec<SqlRow>(`SELECT * FROM match_reference_cleanup`).toArray(),
      terminalRelease: state.storage.sql.exec<SqlRow>(
        `SELECT * FROM match_terminal_release`,
      ).toArray(),
      assignments: state.storage.sql.exec<SqlRow>(`SELECT * FROM match_seat_assignment`).toArray(),
    }));
    expect(coexistence.oldCleanup).toEqual([
      expect.objectContaining({ registration_id: oldReference.registrationId, seat_id: 'player-1' }),
    ]);
    expect(coexistence.terminalRelease).toEqual([]);
    expect(coexistence.assignments).toEqual([]);

    await runInDurableObject(battle.stub, async (instance, state) => {
      state.storage.sql.exec(
        `UPDATE do_deadline SET due_at_ms = ? WHERE deadline_kind = 'coordinator-cleanup'`,
        Date.now() - 1,
      );
      await state.storage.setAlarm(Date.now() + 60_000);
      await (instance as MatchDO).alarm();
    });
    await expect(coordinatorFor(old.sessionId).checkMatch(oldReference)).resolves.toEqual({
      state: 'missing',
    });
  });

  it('unregister後に参照が残ればreservation release phaseを永続してalarm再試行する', async () => {
    const battle = await startReservedNpcBattle();
    const extra = {
      sessionId: battle.session.sessionId,
      sessionVersion: battle.session.sessionVersion,
      matchId: battle.id,
      registrationId: crypto.randomUUID(),
      registrationEpochMs: Date.now() + 1,
    };
    await battle.coordinator.registerMatch(extra);

    await battle.stub.cancelNpcBattle({
      principal: battle.session,
      reason: 'server_cancelled',
    });
    const pending = await runInDurableObject(battle.stub, (_instance, state) => ({
      release: state.storage.sql.exec<SqlRow>(`SELECT * FROM match_terminal_release`).one(),
      deadline: state.storage.sql.exec<SqlRow>(
        `SELECT * FROM do_deadline WHERE deadline_kind = 'coordinator-terminal-release'`,
      ).one(),
    }));
    expect(pending.release).toMatchObject({
      release_phase: 'reservation_release_pending',
      retry_attempt: 1,
      seed: battle.seed,
    });
    expect(pending.deadline).toMatchObject({
      deadline_kind: 'coordinator-terminal-release',
    });

    await battle.coordinator.unregisterMatch(extra);
    await runInDurableObject(battle.stub, async (instance, state) => {
      state.storage.sql.exec(
        `UPDATE do_deadline SET due_at_ms = ?
          WHERE deadline_kind = 'coordinator-terminal-release'`,
        Date.now() - 1,
      );
      await state.storage.setAlarm(Date.now() + 60_000);
      await (instance as MatchDO).alarm();
    });
    const cleaned = await runInDurableObject(battle.stub, (_instance, state) => ({
      release: state.storage.sql.exec<SqlRow>(`SELECT * FROM match_terminal_release`).toArray(),
      deadline: state.storage.sql.exec<SqlRow>(
        `SELECT * FROM do_deadline WHERE deadline_kind = 'coordinator-terminal-release'`,
      ).toArray(),
    }));
    expect(cleaned).toEqual({ release: [], deadline: [] });
  });

  it('stale terminal releaseが新予約と競合してもoutboxだけ完了し新予約を保つ', async () => {
    const battle = await startReservedNpcBattle();
    const release = await runInDurableObject(battle.stub, async (instance, state) => {
      const target = instance as unknown as {
        cancelNpcBattle(input: {
          principal: MatchSessionPrincipal;
          reason: 'server_cancelled';
        }): Promise<unknown>;
        retryTerminalRelease(deadlineKey: string): Promise<boolean>;
      };
      const retry = target.retryTerminalRelease.bind(instance);
      target.retryTerminalRelease = async () => false;
      try {
        await target.cancelNpcBattle({
          principal: battle.session,
          reason: 'server_cancelled',
        });
      } finally {
        target.retryTerminalRelease = retry;
      }
      return state.storage.sql.exec<{
        registration_id: string;
        registration_epoch_ms: number;
        release_phase: string;
      }>(
        `SELECT registration_id, registration_epoch_ms, release_phase
           FROM match_terminal_release`,
      ).one();
    });
    expect(release.release_phase).toBe('unregister_pending');

    const reference = {
      sessionId: battle.session.sessionId,
      sessionVersion: battle.session.sessionVersion,
      matchId: battle.id,
      registrationId: release.registration_id,
      registrationEpochMs: release.registration_epoch_ms,
    };
    await expect(battle.coordinator.unregisterMatch(reference)).resolves.toEqual({
      state: 'acknowledged',
    });
    await expect(battle.coordinator.releaseNpcMatch({
      sessionId: battle.session.sessionId,
      accountId: battle.session.accountId,
      sessionVersion: battle.session.sessionVersion,
      matchId: battle.id,
      seed: battle.seed,
    })).resolves.toEqual({ state: 'released' });
    const next = await battle.coordinator.reserveNpcMatch({
      sessionId: battle.session.sessionId,
      accountId: battle.session.accountId,
      sessionVersion: battle.session.sessionVersion,
    });
    expect(next).toMatchObject({ state: 'reserved', created: true });
    if (next.state !== 'reserved') throw new Error('Expected next NPC reservation');

    await runInDurableObject(battle.stub, async (instance, state) => {
      const deadlineKey = state.storage.sql.exec<{ deadline_key: string }>(
        `SELECT deadline_key FROM do_deadline
          WHERE deadline_kind = 'coordinator-terminal-release'`,
      ).one().deadline_key;
      await expect(
        (
          instance as unknown as {
            retryTerminalRelease(deadlineKey: string): Promise<boolean>;
          }
        ).retryTerminalRelease(deadlineKey),
      ).resolves.toBe(true);
    });

    const outbox = await runInDurableObject(battle.stub, (_instance, state) => ({
      releases: state.storage.sql.exec<SqlRow>(`SELECT * FROM match_terminal_release`).toArray(),
      deadlines: state.storage.sql.exec<SqlRow>(
        `SELECT * FROM do_deadline WHERE deadline_kind = 'coordinator-terminal-release'`,
      ).toArray(),
    }));
    expect(outbox).toEqual({ releases: [], deadlines: [] });
    await expect(battle.coordinator.reserveNpcMatch({
      sessionId: battle.session.sessionId,
      accountId: battle.session.accountId,
      sessionVersion: battle.session.sessionVersion,
    })).resolves.toEqual({ ...next, created: false });
  });

  it('malformed coordinator ACK/resultを成功扱いせずterminal outboxを保持する', async () => {
    const battle = await startReservedNpcBattle();
    await runInDurableObject(battle.stub, async (instance, state) => {
      const target = instance as unknown as {
        cancelNpcBattle(input: {
          principal: MatchSessionPrincipal;
          reason: 'server_cancelled';
        }): Promise<unknown>;
        retryTerminalRelease(deadlineKey: string, coordinator?: unknown): Promise<boolean>;
      };
      const retry = target.retryTerminalRelease.bind(instance);
      target.retryTerminalRelease = async () => false;
      await target.cancelNpcBattle({
        principal: battle.session,
        reason: 'server_cancelled',
      });
      target.retryTerminalRelease = retry;
      const key = state.storage.sql.exec<{ deadline_key: string }>(
        `SELECT deadline_key FROM do_deadline
          WHERE deadline_kind = 'coordinator-terminal-release'`,
      ).one().deadline_key;

      let releaseCalls = 0;
      await expect(retry(key, {
        unregisterMatch: async () => ({ state: 'acknowledged', extra: true }),
        releaseNpcMatch: async () => {
          releaseCalls += 1;
          return { state: 'released' };
        },
      })).resolves.toBe(false);
      expect(releaseCalls).toBe(0);
      expect(state.storage.sql.exec<SqlRow>(
        `SELECT release_phase, retry_attempt FROM match_terminal_release`,
      ).one()).toEqual({ release_phase: 'unregister_pending', retry_attempt: 1 });

      await expect(retry(key, {
        unregisterMatch: async () => ({ state: 'acknowledged' }),
        releaseNpcMatch: async () => ({ state: 'missing', extra: true }),
      })).resolves.toBe(false);
      expect(state.storage.sql.exec<SqlRow>(
        `SELECT release_phase, retry_attempt FROM match_terminal_release`,
      ).one()).toEqual({
        release_phase: 'reservation_release_pending',
        retry_attempt: 1,
      });
    });
  });
});

describe('OLG-122 MatchDO command idempotency and revision', () => {
  it('同一commandの逐次・並行再送を同じ応答へ収束させ、1回だけ適用する', async () => {
    const battle = await startReservedNpcBattle();
    const before = await battle.stub.getNpcBattleSnapshot(battle.session);
    const engineAction = searchAi({ keepHand: 2 }).choose(
      before.state as BattleState,
      HUMAN_PLAYER,
    );
    const command = npcCommand(
      battle.id,
      0,
      stableHumanAction(before, engineAction),
      nextCommandId(),
    );

    const [first, concurrentReplay] = await Promise.all([
      battle.stub.applyNpcBattleCommand({ principal: battle.session, command }),
      battle.stub.applyNpcBattleCommand({ principal: battle.session, command }),
    ]);
    expect(first).toEqual(concurrentReplay);
    expect(first).toMatchObject({
      state: 'accepted',
      baseRevision: 0,
      revision: 1,
    });
    const afterFirst = await battle.stub.getNpcBattleSnapshot(battle.session);

    const sequentialReplay = await battle.stub.applyNpcBattleCommand({
      principal: battle.session,
      command,
    });
    expect(sequentialReplay).toEqual(first);
    await expect(battle.stub.getNpcBattleSnapshot(battle.session)).resolves.toEqual(afterFirst);
    expect(afterFirst.steps.length).toBeGreaterThan(before.steps.length);

    await expectMatchInstanceError(
      battle.stub,
      (instance) => instance.applyNpcBattleCommand({
        principal: { ...battle.session, accountId: crypto.randomUUID() },
        command,
      }),
      'MATCH_BATTLE_ACCESS_DENIED',
    );

    const driftError = await runInDurableObject(battle.stub, async (instance) => {
      const target = instance as unknown as {
        battleRevision: ReturnType<typeof parseMatchRevision>;
      };
      const authoritativeRevision = target.battleRevision;
      target.battleRevision = parseMatchRevision(0);
      try {
        await (instance as MatchDO).applyNpcBattleCommand({
          principal: battle.session,
          command,
        });
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      } finally {
        target.battleRevision = authoritativeRevision;
      }
    });
    expect(driftError).toBe('MATCH_BATTLE_STATE_INVALID');

    const counters = await runInDurableObject(battle.stub, (instance) => {
      const target = instance as unknown as {
        battleRevision: number | null;
        battleCommands: { size: number };
        battleRuntime: { commandRevision(): number } | null;
      };
      return {
        revision: target.battleRevision,
        records: target.battleCommands.size,
        adapterRevision: target.battleRuntime?.commandRevision() ?? null,
      };
    });
    expect(counters).toEqual({ revision: 1, records: 1, adapterRevision: 1 });
  });

  it('同じrevisionの異なるcommandを直列化し、一方だけ適用する', async () => {
    const battle = await startReservedNpcBattle();
    const before = await battle.stub.getNpcBattleSnapshot(battle.session);
    const action = stableHumanAction(
      before,
      searchAi({ keepHand: 2 }).choose(before.state as BattleState, HUMAN_PLAYER),
    );
    const first = npcCommand(battle.id, 0, action);
    const second = npcCommand(battle.id, 0, action);

    const outcomes = await Promise.all([
      battle.stub.applyNpcBattleCommand({ principal: battle.session, command: first }),
      battle.stub.applyNpcBattleCommand({ principal: battle.session, command: second }),
    ]);
    expect(outcomes.filter((result) => result.state === 'accepted')).toHaveLength(1);
    expect(outcomes.filter((result) => result.state === 'rejected')).toEqual([
      expect.objectContaining({
        errorCode: 'MATCH_REVISION_MISMATCH',
        relation: 'stale',
        revision: 1,
      }),
    ]);
    const after = await battle.stub.getNpcBattleSnapshot(battle.session);
    expect(after.steps.length).toBeGreaterThan(before.steps.length);
    const adapterRevision = await runInDurableObject(battle.stub, (instance) => (
      instance as unknown as { battleRuntime: { commandRevision(): number } }
    ).battleRuntime.commandRevision());
    expect(adapterRevision).toBe(1);
  });

  it('過去commandIdの改変は試合進行後もoriginalRevision付きconflictにする', async () => {
    const battle = await startReservedNpcBattle();
    const before = await battle.stub.getNpcBattleSnapshot(battle.session);
    const commandId = nextCommandId();
    const action = stableHumanAction(
      before,
      searchAi({ keepHand: 2 }).choose(before.state as BattleState, HUMAN_PLAYER),
    );
    const original = npcCommand(battle.id, 0, action, commandId);
    const accepted = await battle.stub.applyNpcBattleCommand({
      principal: battle.session,
      command: original,
    });
    expect(accepted).toMatchObject({ state: 'accepted', revision: 1 });
    const afterFirst = await battle.stub.getNpcBattleSnapshot(battle.session);
    const nextAction = stableHumanAction(
      afterFirst,
      searchAi({ keepHand: 2 }).choose(afterFirst.state as BattleState, HUMAN_PLAYER),
    );
    await expect(
      battle.stub.applyNpcBattleCommand({
        principal: battle.session,
        command: npcCommand(battle.id, 1, nextAction),
      }),
    ).resolves.toMatchObject({ state: 'accepted', revision: 2 });
    const after = await battle.stub.getNpcBattleSnapshot(battle.session);

    for (const changed of [
      npcCommand(battle.id, 0, { type: 'endTurn' }, commandId),
      npcCommand(battle.id, 2, action, commandId),
    ]) {
      const conflict = await battle.stub.applyNpcBattleCommand({
        principal: battle.session,
        command: changed,
      });
      expect(conflict).toMatchObject({
        state: 'rejected',
        errorCode: 'MATCH_COMMAND_ID_CONFLICT',
        originalRevision: 1,
      });
      expect('revision' in conflict).toBe(false);
      await expect(battle.stub.getNpcBattleSnapshot(battle.session)).resolves.toEqual(after);
    }
  });

  it('future/stale/illegal拒否をcommandIdへ固定し、後のstateでも同じ結果を返す', async () => {
    const battle = await startReservedNpcBattle();
    const before = await battle.stub.getNpcBattleSnapshot(battle.session);
    const future = npcCommand(battle.id, 1, { type: 'endPlay' });
    const illegal = npcCommand(battle.id, 0, { type: 'endPlay', extra: true });
    const futureResult = await battle.stub.applyNpcBattleCommand({
      principal: battle.session,
      command: future,
    });
    const illegalResult = await battle.stub.applyNpcBattleCommand({
      principal: battle.session,
      command: illegal,
    });
    expect(futureResult).toMatchObject({
      state: 'rejected',
      errorCode: 'MATCH_REVISION_MISMATCH',
      relation: 'ahead',
      revision: 0,
    });
    expect(illegalResult).toMatchObject({
      state: 'rejected',
      errorCode: 'MATCH_ACTION_INVALID',
      revision: 0,
    });
    await expect(battle.stub.getNpcBattleSnapshot(battle.session)).resolves.toEqual(before);

    const action = stableHumanAction(
      before,
      searchAi({ keepHand: 2 }).choose(before.state as BattleState, HUMAN_PLAYER),
    );
    const accepted = await battle.stub.applyNpcBattleCommand({
      principal: battle.session,
      command: npcCommand(battle.id, 0, action),
    });
    expect(accepted).toMatchObject({ state: 'accepted', revision: 1 });

    await expect(
      battle.stub.applyNpcBattleCommand({ principal: battle.session, command: future }),
    ).resolves.toEqual(futureResult);
    await expect(
      battle.stub.applyNpcBattleCommand({ principal: battle.session, command: illegal }),
    ).resolves.toEqual(illegalResult);

    const stale = npcCommand(battle.id, 0, { type: 'endPlay' });
    const staleResult = await battle.stub.applyNpcBattleCommand({
      principal: battle.session,
      command: stale,
    });
    expect(staleResult).toMatchObject({
      state: 'rejected',
      errorCode: 'MATCH_REVISION_MISMATCH',
      relation: 'stale',
      revision: 1,
    });
    await expect(
      battle.stub.applyNpcBattleCommand({ principal: battle.session, command: stale }),
    ).resolves.toEqual(staleResult);
  });

  it('壊れたpayloadはcommandIdを消費せず、同じIDの正しいcommandを受理する', async () => {
    const battle = await startReservedNpcBattle();
    const commandId = nextCommandId();
    await expectMatchInstanceError(
      battle.stub,
      (instance) => instance.applyNpcBattleCommand({
        principal: battle.session,
        command: npcCommand(battle.id, 0, { type: 'endPlay', value: undefined }, commandId),
      }),
      'MATCH_BATTLE_INPUT_INVALID',
    );

    await expect(
      battle.stub.applyNpcBattleCommand({
        principal: battle.session,
        command: npcCommand(battle.id, 0, { type: 'endPlay' }, commandId),
      }),
    ).resolves.toMatchObject({ state: 'accepted', revision: 1 });
  });

  it('最終commandの永続化失敗後、同一再送で再適用せずterminal確定する', async () => {
    const battle = await startReservedNpcBattle();
    const recovered = await runInDurableObject(battle.stub, async (instance) => {
      const finished = await leaveFinishedRuntimeBeforeTerminalCommit(
        instance as MatchDO,
        battle.session,
        battle.id,
      );
      const firstReplay = await (instance as MatchDO).applyNpcBattleCommand({
        principal: battle.session,
        command: finished.finalCommand,
      });
      const secondReplay = await (instance as MatchDO).applyNpcBattleCommand({
        principal: battle.session,
        command: finished.finalCommand,
      });
      const lifecycle = await (instance as MatchDO).getNpcBattleLifecycle(battle.session);
      return { finished, firstReplay, secondReplay, lifecycle };
    });

    expect(recovered.firstReplay).toEqual(recovered.secondReplay);
    expect(recovered.firstReplay).toMatchObject({
      state: 'accepted',
    });
    expect(Object.keys(recovered.firstReplay).sort()).toEqual([
      'baseRevision',
      'commandId',
      'matchId',
      'revision',
      'state',
      'type',
    ]);
    expect(recovered.lifecycle).toMatchObject({
      state: 'finished',
      terminalResult: {
        kind: 'finished',
        finalStateHash: recovered.finished.currentStateHash,
        appliedActions: recovered.finished.steps.length,
      },
    });
  }, 20_000);
});
