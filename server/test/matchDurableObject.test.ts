import { env } from 'cloudflare:workers';
import {
  actingPlayer,
  legalActions,
  searchAi,
  type BattleAction,
  type BattleState,
} from '@bravers/engine';
import {
  MATCH_PLAYER_PROJECTION_VERSION,
  MATCH_VIEWER_EVENT_VERSION,
  parseMatchCommandId,
  parseMatchId,
  parseMatchRevision,
  parseMatchServerFrame,
  type MatchCommandCandidate,
  type MatchCommandId,
  type MatchServerFrame,
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
  MAX_MATCH_RESUME_EVENT_BATCHES,
  MAX_OUTSTANDING_SEAT_TOKENS,
  SEAT_AUTH_FRAME_TIMEOUT_MS,
  SEAT_TOKEN_TTL_MS,
  type MatchSessionPrincipal,
  type MatchSeatId,
} from '../src/match/matchDurableObject';
import {
  EngineBattleAdapterError,
  HUMAN_PLAYER,
  NPC_PLAYER,
  matchActionFromEngineAction,
  type AuthoritativeBattleCheckpoint,
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
import { MAX_MATCH_CLIENT_FRAME_BYTES } from '../src/match/matchWire';

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

type BattlePersistenceCutpoint =
  | 'afterBattleActivationCommit'
  | 'afterBattleCommandCommit'
  | 'afterBattleCommandInstall';

async function failNextBattlePersistenceCutpoint(
  stub: MatchStub,
  cutpoint: BattlePersistenceCutpoint,
  errorMessage: string,
): Promise<void> {
  await runInDurableObject(stub, (instance) => {
    const target = instance as unknown as Record<
      BattlePersistenceCutpoint,
      () => Promise<void>
    >;
    target[cutpoint] = async () => {
      throw new Error(errorMessage);
    };
  });
}

async function expectDurableObjectReset(
  operation: Promise<unknown>,
  reason: string,
): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    message: reason,
    durableObjectReset: true,
  });
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

async function leaveFinalCommandRolledBack(
  instance: MatchDO,
  session: MatchSessionPrincipal,
  matchIdValue: string,
): Promise<{
  beforeFinal: AuthoritativeBattleSnapshot;
  finalCommand: MatchCommandCandidate;
}> {
  const target = instance as unknown as {
    battleRuntime: {
      authoritativeSnapshot(): AuthoritativeBattleSnapshot;
    } | null;
    writeBattleTerminal: (...args: unknown[]) => void;
    applyNpcBattleCommand: MatchDO['applyNpcBattleCommand'];
  };
  const originalWriteTerminal = target.writeBattleTerminal;
  const injectedError = 'INJECTED_TERMINAL_COMMIT_FAILURE';
  target.writeBattleTerminal = () => {
    throw new Error(injectedError);
  };
  let errorMessage: string | null = null;
  let revision = 0;
  let finalCommand: MatchCommandCandidate | null = null;
  let beforeFinal: AuthoritativeBattleSnapshot | null = null;
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
      const beforeAttempt = structuredClone(snapshot);
      try {
        const result = await target.applyNpcBattleCommand({
          principal: session,
          command,
        });
        if (result.state !== 'accepted') throw new Error(result.errorCode);
        revision = result.revision;
      } catch (error) {
        finalCommand = command;
        beforeFinal = beforeAttempt;
        errorMessage = error instanceof Error ? error.message : String(error);
        break;
      }
    }
  } finally {
    target.writeBattleTerminal = originalWriteTerminal;
  }
  if (errorMessage !== injectedError) {
    throw new Error(`Expected injected terminal failure, received: ${errorMessage}`);
  }
  if (!finalCommand || !beforeFinal) throw new Error('Expected final command fixture');
  const runtime = target.battleRuntime;
  if (!runtime) throw new Error('Expected active in-memory battle runtime');
  if (JSON.stringify(runtime.authoritativeSnapshot()) !== JSON.stringify(beforeFinal)) {
    throw new Error('Terminal rollback changed authoritative runtime');
  }
  return {
    beforeFinal,
    finalCommand,
  };
}

async function runTerminalCleanupAlarm(stub: MatchStub): Promise<void> {
  await runInDurableObject(stub, async (instance, state) => {
    state.storage.sql.exec(
      `UPDATE do_deadline SET due_at_ms = ?
        WHERE deadline_kind = 'coordinator-terminal-release'`,
      Date.now() - 1,
    );
    await state.storage.setAlarm(Date.now() + 60_000);
    await (instance as MatchDO).alarm();
  });
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

function socketOutcomes(
  socket: WebSocket,
  expectedCount: number,
  timeoutMs = 2_000,
): Promise<SocketOutcome[]> {
  return new Promise((resolve, reject) => {
    const outcomes: SocketOutcome[] = [];
    const finish = () => {
      cleanup();
      resolve(outcomes);
    };
    const onMessage = (event: MessageEvent) => {
      outcomes.push({ kind: 'message', data: String(event.data) });
      if (outcomes.length === expectedCount) finish();
    };
    const onClose = (event: CloseEvent) => {
      outcomes.push({ kind: 'close', code: event.code, reason: event.reason });
      finish();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Unexpected WebSocket error'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket outcomes'));
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

function socketTranscriptUntilClose(
  socket: WebSocket,
  timeoutMs = 5_000,
): Promise<SocketOutcome[]> {
  return new Promise((resolve, reject) => {
    const outcomes: SocketOutcome[] = [];
    const onMessage = (event: MessageEvent) => {
      outcomes.push({ kind: 'message', data: String(event.data) });
    };
    const onClose = (event: CloseEvent) => {
      outcomes.push({ kind: 'close', code: event.code, reason: event.reason });
      cleanup();
      resolve(outcomes);
    };
    const onError = () => {
      cleanup();
      reject(new Error('Unexpected WebSocket error'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket close transcript'));
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

async function authenticateBattle(
  socket: WebSocket,
  seatToken: string,
): Promise<Extract<MatchServerFrame, { type: 'matchProjection' }>> {
  const pending = socketOutcomes(socket, 2);
  socket.send(JSON.stringify({ type: 'auth', seatToken }));
  const outcomes = await pending;
  expect(outcomes[0]).toEqual({ kind: 'message', data: 'auth_ok' });
  const projectionMessage = outcomes[1];
  if (projectionMessage?.kind !== 'message') {
    throw new Error('Expected initial match projection');
  }
  const decoded = parseMatchServerFrame(JSON.parse(projectionMessage.data) as unknown);
  if (decoded?.type !== 'matchProjection') {
    throw new Error('Expected exact match projection frame');
  }
  return decoded;
}

async function resumeBattle(
  socket: WebSocket,
  seatToken: string,
  lastEventSequence: number,
): Promise<Extract<MatchServerFrame, { type: 'matchProjection' }>> {
  const pending = socketOutcomes(socket, 2);
  socket.send(JSON.stringify({
    type: 'auth',
    seatToken,
    resume: {
      projectionVersion: MATCH_PLAYER_PROJECTION_VERSION,
      viewerEventVersion: MATCH_VIEWER_EVENT_VERSION,
      lastEventSequence,
    },
  }));
  const outcomes = await pending;
  expect(outcomes[0]).toEqual({ kind: 'message', data: 'auth_ok' });
  const projectionMessage = outcomes[1];
  if (projectionMessage?.kind !== 'message') {
    throw new Error('Expected resumed match projection');
  }
  const decoded = parseMatchServerFrame(JSON.parse(projectionMessage.data) as unknown);
  if (decoded?.type !== 'matchProjection') {
    throw new Error('Expected exact resumed match projection frame');
  }
  return decoded;
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
          getNpcBattleRecoveryStatus: async () => ({
            state: 'provisioning' as const,
            matchId: 'local-smoke',
          }),
          getNpcBattleReceipt: async () => null,
          getNpcBattlePublicResult: async () => null,
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
      terminalRelease: [expect.objectContaining({ release_phase: 'unregister_pending' })],
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

    await runTerminalCleanupAlarm(battle.stub);
    const next = await battle.coordinator.reserveNpcMatch({
      sessionId: battle.session.sessionId,
      accountId: battle.session.accountId,
      sessionVersion: battle.session.sessionVersion,
    });
    expect(next).toMatchObject({ state: 'reserved', created: true });
    if (next.state === 'reserved') expect(next.matchId).not.toBe(battle.id);
  }, 20_000);

  it('active DO eviction後も保存履歴から同じruntimeを復元して続行する', async () => {
    const battle = await startReservedNpcBattle();
    const before = await battle.stub.getNpcBattleSnapshot(battle.session);
    await evictDurableObject(battle.stub);

    await expect(
      battle.stub.startNpcBattle({ principal: battle.session, seed: battle.seed }),
    ).resolves.toEqual({ state: 'ready', created: false });
    await expect(battle.stub.getNpcBattleSnapshot(battle.session)).resolves.toEqual(before);
    await expect(battle.stub.getNpcBattleLifecycle(battle.session)).resolves.toMatchObject({
      state: 'active',
    });
    await expect(battle.stub.getNpcBattleResult(battle.session)).resolves.toBeNull();
    await expect(
      battle.stub.applyNpcBattleCommand({
        principal: battle.session,
        command: npcCommand(battle.id, 0, { type: 'endPlay' }),
      }),
    ).resolves.toMatchObject({ state: 'accepted', revision: 1 });

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

  it('認証直後の秘匿projectionからcommandを適用し、exact再送を同じreceipt/projectionへ収束させる', async () => {
    const battle = await startReservedNpcBattle();
    const issued = await battle.stub.issueSeatToken(battle.session);
    expect(issued.state).toBe('issued');
    if (issued.state !== 'issued') throw new Error('Expected issued seat token');
    const socket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    const initial = await authenticateBattle(socket, issued.seatToken);
    const before = await battle.stub.getNpcBattleSnapshot(battle.session);
    expect(initial.projection).toMatchObject({
      matchId: battle.id,
      viewerSeat: 'player-1',
      viewerPlayer: HUMAN_PLAYER,
      revision: 0,
      terminal: null,
    });
    expect(initial.projection.players[NPC_PLAYER].hand).toEqual({
      visibility: 'hidden',
      count: before.battleCards.players[NPC_PLAYER].hand.length,
    });
    const initialEncoded = JSON.stringify(initial);
    for (const card of [
      ...before.battleCards.players[NPC_PLAYER].hand,
      ...before.battleCards.players[NPC_PLAYER].deck,
      ...before.battleCards.players[NPC_PLAYER].ap,
    ]) {
      expect(initialEncoded).not.toContain(card.battleCardId);
    }

    const action = initial.projection.legalActions[0];
    if (!action) throw new Error('Expected a legal player action');
    const command = npcCommand(battle.id, initial.projection.revision, action);
    const encodedCommand = JSON.stringify({ type: 'matchCommand', command });
    const firstPending = socketOutcome(socket);
    socket.send(encodedCommand);
    const firstOutcome = await firstPending;
    if (firstOutcome.kind !== 'message') throw new Error('Expected command update');
    const firstUpdate = parseMatchServerFrame(JSON.parse(firstOutcome.data) as unknown);
    expect(firstUpdate).toMatchObject({
      type: 'matchCommandUpdate',
      receipt: { state: 'accepted', baseRevision: 0, revision: 1 },
      projection: { revision: 1 },
    });
    if (firstUpdate?.type !== 'matchCommandUpdate') {
      throw new Error('Expected exact command update frame');
    }

    const duplicatePending = socketOutcome(socket);
    socket.send(encodedCommand);
    const duplicateOutcome = await duplicatePending;
    if (duplicateOutcome.kind !== 'message') throw new Error('Expected duplicate update');
    const duplicateUpdate = parseMatchServerFrame(JSON.parse(duplicateOutcome.data) as unknown);
    if (duplicateUpdate?.type !== 'matchCommandUpdate') {
      throw new Error('Expected exact duplicate command update frame');
    }
    expect(duplicateUpdate.receipt).toEqual(firstUpdate.receipt);
    expect(duplicateUpdate.projection).toEqual(firstUpdate.projection);
    expect(duplicateUpdate.sync).toEqual({
      type: 'matchViewerSync',
      mode: 'delta',
      afterEventSequence: firstUpdate.projection.eventSequence,
      batches: [],
    });

    const after = await battle.stub.getNpcBattleSnapshot(battle.session);
    const updateEncoded = JSON.stringify(firstUpdate);
    for (const card of [
      ...after.battleCards.players[NPC_PLAYER].hand,
      ...after.battleCards.players[NPC_PLAYER].deck,
      ...after.battleCards.players[NPC_PLAYER].ap,
    ]) {
      expect(updateEncoded).not.toContain(card.battleCardId);
    }
    for (const forbiddenKey of ['seed', 'rngState', 'header', 'stateHash', 'steps']) {
      expect(updateEncoded).not.toContain(`"${forbiddenKey}"`);
    }
    const durable = await runInDurableObject(battle.stub, (_instance, state) => ({
      battle: state.storage.sql.exec<SqlRow>(
        `SELECT revision, command_count FROM match_battle_state`,
      ).one(),
      humanSteps: state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM match_battle_step WHERE source = 'human'`,
      ).one().count,
    }));
    expect(durable).toEqual({
      battle: { revision: 1, command_count: 1 },
      humanSteps: 1,
    });
    socket.close(1000, 'done');
  });

  it('同一socketのback-to-back exact再送は先行配信のcursor更新後も切断せずreceiptへ収束する', async () => {
    const battle = await startReservedNpcBattle();
    const issued = await battle.stub.issueSeatToken(battle.session);
    expect(issued.state).toBe('issued');
    if (issued.state !== 'issued') throw new Error('Expected issued seat token');
    const socket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    const initial = await authenticateBattle(socket, issued.seatToken);
    const action = initial.projection.legalActions[0];
    if (!action) throw new Error('Expected a legal player action');
    const command = npcCommand(battle.id, initial.projection.revision, action);
    const encodedCommand = JSON.stringify({ type: 'matchCommand', command });
    const pending = socketOutcomes(socket, 2);

    await runInDurableObject(battle.stub, async (instance, state) => {
      const serverSocket = state.getWebSockets()[0];
      if (!serverSocket) throw new Error('Expected authenticated server socket');
      await Promise.all([
        (instance as MatchDO).webSocketMessage(serverSocket, encodedCommand),
        (instance as MatchDO).webSocketMessage(serverSocket, encodedCommand),
      ]);
    });

    const outcomes = await pending;
    const updates = outcomes.map((outcome) => {
      if (outcome.kind !== 'message') throw new Error('Expected command update without close');
      const decoded = parseMatchServerFrame(JSON.parse(outcome.data) as unknown);
      if (decoded?.type !== 'matchCommandUpdate') {
        throw new Error('Expected exact command update frame');
      }
      return decoded;
    });
    expect(updates[1]?.receipt).toEqual(updates[0]?.receipt);
    expect(updates[1]?.projection).toEqual(updates[0]?.projection);
    expect(updates[1]?.sync).toEqual({
      type: 'matchViewerSync',
      mode: 'delta',
      afterEventSequence: updates[0]?.projection.eventSequence,
      batches: [],
    });
    expect(await battle.stub.getNpcBattleReceipt({
      principal: battle.session,
      commandId: command.commandId,
    })).toEqual(updates[0]?.receipt);
    socket.close(1000, 'done');
  });

  it('domain拒否・revision不一致・ID衝突もcurrent projection付きexact updateで返す', async () => {
    const battle = await startReservedNpcBattle();
    const issued = await battle.stub.issueSeatToken(battle.session);
    expect(issued.state).toBe('issued');
    if (issued.state !== 'issued') throw new Error('Expected issued seat token');
    const socket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    const initial = await authenticateBattle(socket, issued.seatToken);
    const legalAction = initial.projection.legalActions[0];
    if (!legalAction) throw new Error('Expected a legal player action');

    const sendCommand = async (command: MatchCommandCandidate) => {
      const pending = socketOutcome(socket);
      socket.send(JSON.stringify({ type: 'matchCommand', command }));
      const outcome = await pending;
      if (outcome.kind !== 'message') throw new Error('Expected command update');
      const decoded = parseMatchServerFrame(JSON.parse(outcome.data) as unknown);
      if (decoded?.type !== 'matchCommandUpdate') {
        throw new Error('Expected exact command update frame');
      }
      return decoded;
    };

    const invalid = npcCommand(battle.id, 0, { type: 'unknown' });
    const invalidUpdate = await sendCommand(invalid);
    expect(invalidUpdate).toMatchObject({
      receipt: {
        state: 'rejected',
        errorCode: 'MATCH_ACTION_INVALID',
        revision: 0,
      },
      projection: { revision: 0 },
    });
    await expect(sendCommand(invalid)).resolves.toEqual(invalidUpdate);

    const aheadUpdate = await sendCommand(npcCommand(battle.id, 1, legalAction));
    expect(aheadUpdate).toMatchObject({
      receipt: {
        state: 'rejected',
        errorCode: 'MATCH_REVISION_MISMATCH',
        revision: 0,
        relation: 'ahead',
      },
      projection: { revision: 0 },
    });

    const acceptedCommand = npcCommand(battle.id, 0, legalAction);
    const acceptedUpdate = await sendCommand(acceptedCommand);
    expect(acceptedUpdate).toMatchObject({
      receipt: { state: 'accepted', baseRevision: 0, revision: 1 },
      projection: { revision: 1 },
    });

    const staleUpdate = await sendCommand(npcCommand(battle.id, 0, legalAction));
    expect(staleUpdate).toMatchObject({
      receipt: {
        state: 'rejected',
        errorCode: 'MATCH_REVISION_MISMATCH',
        revision: 1,
        relation: 'stale',
      },
      projection: { revision: 1 },
    });

    const conflictUpdate = await sendCommand(npcCommand(
      battle.id,
      0,
      { type: 'unknown' },
      acceptedCommand.commandId,
    ));
    expect(conflictUpdate).toMatchObject({
      receipt: {
        state: 'rejected',
        errorCode: 'MATCH_COMMAND_ID_CONFLICT',
        originalRevision: 1,
      },
      projection: { revision: 1 },
    });

    const durable = await runInDurableObject(battle.stub, (_instance, state) =>
      state.storage.sql.exec<SqlRow>(
        `SELECT revision, command_count, rejection_count FROM match_battle_state`,
      ).one());
    expect(durable).toEqual({ revision: 1, command_count: 4, rejection_count: 3 });
    socket.close(1000, 'done');
  });

  it.each(['auth-ready', 'game-command'] as const)(
    '想定外の%s例外は内部詳細を隠して1011でcloseする',
    async (failurePoint) => {
      const battle = await startReservedNpcBattle();
      const issued = await battle.stub.issueSeatToken(battle.session);
      expect(issued.state).toBe('issued');
      if (issued.state !== 'issued') throw new Error('Expected issued seat token');
      const socket = await openPlayerSocket(battle.stub, battle.id, battle.session);
      if (failurePoint === 'auth-ready') {
        await runInDurableObject(battle.stub, (instance) => {
          const target = instance as unknown as {
            sendAuthenticatedReady: () => Promise<void>;
          };
          target.sendAuthenticatedReady = async () => {
            throw new Error('SECRET_READY_FAILURE');
          };
        });
        const closed = socketOutcome(socket);
        socket.send(JSON.stringify({ type: 'auth', seatToken: issued.seatToken }));
        await expect(closed).resolves.toEqual({
          kind: 'close',
          code: 1011,
          reason: 'MATCH_UNAVAILABLE',
        });
      } else {
        const initial = await authenticateBattle(socket, issued.seatToken);
        const legalAction = initial.projection.legalActions[0];
        if (!legalAction) throw new Error('Expected a legal player action');
        await runInDurableObject(battle.stub, (instance) => {
          const target = instance as unknown as {
            applyNpcBattleCommandExclusive: () => Promise<void>;
          };
          target.applyNpcBattleCommandExclusive = async () => {
            throw new Error('SECRET_COMMAND_FAILURE');
          };
        });
        const closed = socketOutcome(socket);
        socket.send(JSON.stringify({
          type: 'matchCommand',
          command: npcCommand(battle.id, 0, legalAction),
        }));
        await expect(closed).resolves.toEqual({
          kind: 'close',
          code: 1011,
          reason: 'MATCH_UNAVAILABLE',
        });
      }
    },
  );

  it('raw/canonical上限違反はcommandIdを消費せず同じIDの修正版を受理する', async () => {
    const battle = await startReservedNpcBattle();
    const firstIssued = await battle.stub.issueSeatToken(battle.session);
    expect(firstIssued.state).toBe('issued');
    if (firstIssued.state !== 'issued') throw new Error('Expected issued seat token');
    const firstSocket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    const initial = await authenticateBattle(firstSocket, firstIssued.seatToken);
    const action = initial.projection.legalActions[0];
    if (!action) throw new Error('Expected a legal player action');
    const command = npcCommand(battle.id, 0, action);
    const validFrame = JSON.stringify({ type: 'matchCommand', command });
    const oversizedFrame = `${validFrame}${' '.repeat(
      MAX_MATCH_CLIENT_FRAME_BYTES - new TextEncoder().encode(validFrame).byteLength + 1,
    )}`;
    expect(new TextEncoder().encode(oversizedFrame).byteLength).toBe(
      MAX_MATCH_CLIENT_FRAME_BYTES + 1,
    );
    const oversizedClose = socketOutcome(firstSocket);
    firstSocket.send(oversizedFrame);
    await expect(oversizedClose).resolves.toEqual({
      kind: 'close',
      code: 1009,
      reason: 'MATCH_FRAME_TOO_LARGE',
    });

    const afterOversized = await runInDurableObject(battle.stub, (_instance, state) =>
      state.storage.sql.exec<SqlRow>(
        `SELECT revision, command_count FROM match_battle_state`,
      ).one());
    expect(afterOversized).toEqual({ revision: 0, command_count: 0 });

    const secondIssued = await battle.stub.issueSeatToken(battle.session);
    expect(secondIssued.state).toBe('issued');
    if (secondIssued.state !== 'issued') throw new Error('Expected issued seat token');
    const secondSocket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    await authenticateBattle(secondSocket, secondIssued.seatToken);
    const canonicalOversizedFrame = JSON.stringify({
      type: 'matchCommand',
      command: {
        ...command,
        action: Object.fromEntries(
          Array.from({ length: 9 }, (_, index) => [`padding${index}`, 'x'.repeat(500)]),
        ),
      },
    });
    expect(new TextEncoder().encode(canonicalOversizedFrame).byteLength).toBeLessThan(
      MAX_MATCH_CLIENT_FRAME_BYTES,
    );
    const canonicalClose = socketOutcome(secondSocket);
    secondSocket.send(canonicalOversizedFrame);
    await expect(canonicalClose).resolves.toEqual({
      kind: 'close',
      code: 1008,
      reason: 'MATCH_FRAME_INVALID',
    });
    const afterCanonical = await runInDurableObject(battle.stub, (_instance, state) =>
      state.storage.sql.exec<SqlRow>(
        `SELECT revision, command_count FROM match_battle_state`,
      ).one());
    expect(afterCanonical).toEqual({ revision: 0, command_count: 0 });

    const thirdIssued = await battle.stub.issueSeatToken(battle.session);
    expect(thirdIssued.state).toBe('issued');
    if (thirdIssued.state !== 'issued') throw new Error('Expected issued seat token');
    const thirdSocket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    await authenticateBattle(thirdSocket, thirdIssued.seatToken);
    const acceptedPending = socketOutcome(thirdSocket);
    thirdSocket.send(validFrame);
    const acceptedOutcome = await acceptedPending;
    if (acceptedOutcome.kind !== 'message') throw new Error('Expected accepted update');
    expect(parseMatchServerFrame(JSON.parse(acceptedOutcome.data) as unknown)).toMatchObject({
      type: 'matchCommandUpdate',
      receipt: {
        state: 'accepted',
        commandId: command.commandId,
        baseRevision: 0,
        revision: 1,
      },
      projection: { revision: 1 },
    });
    thirdSocket.close(1000, 'done');
  });

  it.each([
    { authorizationState: 'invalidated' as const, reason: 'SESSION_ENDED' },
    { authorizationState: 'stale-assignment' as const, reason: 'SEAT_REASSIGNED' },
  ])('$authorizationState認可拒否をraw frame上限より先に判定する', async ({
    authorizationState,
    reason,
  }) => {
    const battle = await startReservedNpcBattle();
    const issued = await battle.stub.issueSeatToken(battle.session);
    expect(issued.state).toBe('issued');
    if (issued.state !== 'issued') throw new Error('Expected issued seat token');
    const socket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    await authenticateBattle(socket, issued.seatToken);
    await runInDurableObject(battle.stub, (_instance, state) => {
      if (authorizationState === 'invalidated') {
        state.storage.sql.exec(
          `INSERT INTO match_session_invalidation (
             session_id, invalidated_version, invalidated_at_ms
           ) VALUES (?, ?, ?)`,
          battle.session.sessionId,
          battle.session.sessionVersion + 1,
          Date.now(),
        );
      } else {
        state.storage.sql.exec(
          `UPDATE match_seat_assignment
              SET assignment_version = assignment_version + 1`,
        );
      }
    });

    const closed = socketOutcome(socket);
    socket.send(`{${'x'.repeat(MAX_MATCH_CLIENT_FRAME_BYTES)}`);
    await expect(closed).resolves.toEqual({ kind: 'close', code: 1008, reason });
    const commandCount = await runInDurableObject(battle.stub, (_instance, state) =>
      state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM match_battle_command`,
      ).one().count);
    expect(commandCount).toBe(0);
  });

  it('final commandはterminal updateを送ってからauthenticated socketをcloseする', async () => {
    const battle = await startReservedNpcBattle();
    const rolledBack = await runInDurableObject(battle.stub, (instance) =>
      leaveFinalCommandRolledBack(instance as MatchDO, battle.session, battle.id));
    const [issued, peerIssued] = await Promise.all([
      battle.stub.issueSeatToken(battle.session),
      battle.stub.issueSeatToken(battle.session),
    ]);
    expect(issued.state).toBe('issued');
    expect(peerIssued.state).toBe('issued');
    if (issued.state !== 'issued' || peerIssued.state !== 'issued') {
      throw new Error('Expected issued seat tokens');
    }
    const socket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    const peerSocket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    const initial = await authenticateBattle(socket, issued.seatToken);
    await authenticateBattle(peerSocket, peerIssued.seatToken);
    expect(initial.projection.revision).toBe(rolledBack.finalCommand.expectedRevision);

    const transcriptPending = socketTranscriptUntilClose(socket);
    const peerTranscriptPending = socketTranscriptUntilClose(peerSocket);
    socket.send(JSON.stringify({
      type: 'matchCommand',
      command: rolledBack.finalCommand,
    }));
    const transcript = await transcriptPending;
    const peerTranscript = await peerTranscriptPending;
    expect(transcript).toHaveLength(2);
    const updateOutcome = transcript[0];
    if (updateOutcome?.kind !== 'message') throw new Error('Expected terminal update');
    const update = parseMatchServerFrame(JSON.parse(updateOutcome.data) as unknown);
    expect(update).toMatchObject({
      type: 'matchCommandUpdate',
      receipt: {
        state: 'accepted',
        revision: rolledBack.finalCommand.expectedRevision + 1,
      },
      projection: {
        revision: rolledBack.finalCommand.expectedRevision + 1,
        phase: 'finished',
        terminal: { state: 'finished' },
        legalActions: [],
      },
    });
    expect(transcript[1]).toEqual({
      kind: 'close',
      code: 1000,
      reason: 'MATCH_ENDED',
    });
    expect(peerTranscript).toHaveLength(2);
    const peerProjectionOutcome = peerTranscript[0];
    if (peerProjectionOutcome?.kind !== 'message') {
      throw new Error('Expected peer terminal projection');
    }
    expect(parseMatchServerFrame(JSON.parse(peerProjectionOutcome.data) as unknown)).toMatchObject({
      type: 'matchProjection',
      projection: {
        revision: rolledBack.finalCommand.expectedRevision + 1,
        terminal: { state: 'finished' },
        legalActions: [],
      },
    });
    expect(peerTranscript[1]).toEqual({
      kind: 'close',
      code: 1000,
      reason: 'MATCH_ENDED',
    });

    const durable = await runInDurableObject(battle.stub, (_instance, state) => ({
      lifecycle: state.storage.sql.exec<SqlRow>(
        `SELECT lifecycle_state FROM match_battle_lifecycle`,
      ).one(),
      terminalCommands: state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM match_battle_command WHERE terminal_flag = 1`,
      ).one().count,
      releases: state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM match_terminal_release`,
      ).one().count,
    }));
    expect(durable).toEqual({
      lifecycle: { lifecycle_state: 'finished' },
      terminalCommands: 1,
      releases: 1,
    });
  }, 20_000);

  it('非terminalのaccepted commandは操作したsocketにmatchCommandUpdate、同一viewerの別タブにはmatchProjectionのみを配る', async () => {
    const battle = await startReservedNpcBattle();
    const [issued, otherTabIssued] = await Promise.all([
      battle.stub.issueSeatToken(battle.session),
      battle.stub.issueSeatToken(battle.session),
    ]);
    expect(issued.state).toBe('issued');
    expect(otherTabIssued.state).toBe('issued');
    if (issued.state !== 'issued' || otherTabIssued.state !== 'issued') {
      throw new Error('Expected issued seat tokens');
    }
    const socket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    const otherTabSocket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    const initial = await authenticateBattle(socket, issued.seatToken);
    await authenticateBattle(otherTabSocket, otherTabIssued.seatToken);

    const action = initial.projection.legalActions[0];
    if (!action) throw new Error('Expected a legal player action');
    const command = npcCommand(battle.id, initial.projection.revision, action);

    const updatePending = socketOutcome(socket);
    const otherTabPending = socketOutcome(otherTabSocket);
    socket.send(JSON.stringify({ type: 'matchCommand', command }));

    const updateOutcome = await updatePending;
    if (updateOutcome.kind !== 'message') throw new Error('Expected command update');
    const update = parseMatchServerFrame(JSON.parse(updateOutcome.data) as unknown);
    expect(update).toMatchObject({
      type: 'matchCommandUpdate',
      receipt: { state: 'accepted', baseRevision: initial.projection.revision, revision: 1 },
      projection: { revision: 1, terminal: null },
    });

    const otherTabOutcome = await otherTabPending;
    if (otherTabOutcome.kind !== 'message') throw new Error('Expected peer-tab projection');
    const otherTabFrame = parseMatchServerFrame(JSON.parse(otherTabOutcome.data) as unknown);
    expect(otherTabFrame).toEqual({
      type: 'matchProjection',
      projection: (update as Extract<MatchServerFrame, { type: 'matchCommandUpdate' }>).projection,
      sync: (update as Extract<MatchServerFrame, { type: 'matchCommandUpdate' }>).sync,
    });
    expect('receipt' in (otherTabFrame as unknown as Record<string, unknown>)).toBe(false);

    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(otherTabSocket.readyState).toBe(WebSocket.OPEN);
    socket.close(1000, 'done');
    otherTabSocket.close(1000, 'done');
  });

  it('final ACK喪失相当でも既存owner socketのexact再送だけを保存ACKへ収束させる', async () => {
    const battle = await startReservedNpcBattle();
    const rolledBack = await runInDurableObject(battle.stub, (instance) =>
      leaveFinalCommandRolledBack(instance as MatchDO, battle.session, battle.id));
    const issued = await battle.stub.issueSeatToken(battle.session);
    expect(issued.state).toBe('issued');
    if (issued.state !== 'issued') throw new Error('Expected issued seat token');
    const socket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    await authenticateBattle(socket, issued.seatToken);
    const beforeCommandCount = await runInDurableObject(battle.stub, (_instance, state) =>
      state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM match_battle_command`,
      ).one().count);
    const committedReceipt = await battle.stub.applyNpcBattleCommand({
      principal: battle.session,
      command: rolledBack.finalCommand,
    });
    expect(committedReceipt).toMatchObject({ state: 'accepted' });
    await evictDurableObject(battle.stub);

    const transcriptPending = socketTranscriptUntilClose(socket);
    socket.send(JSON.stringify({
      type: 'matchCommand',
      command: rolledBack.finalCommand,
    }));
    const transcript = await transcriptPending;
    expect(transcript).toHaveLength(2);
    const updateOutcome = transcript[0];
    if (updateOutcome?.kind !== 'message') throw new Error('Expected replayed terminal ACK');
    const replayed = parseMatchServerFrame(JSON.parse(updateOutcome.data) as unknown);
    expect(replayed).toMatchObject({
      type: 'matchCommandUpdate',
      receipt: {
        state: 'accepted',
        commandId: rolledBack.finalCommand.commandId,
        revision: rolledBack.finalCommand.expectedRevision + 1,
      },
      projection: { terminal: { state: 'finished' }, legalActions: [] },
    });
    if (replayed?.type !== 'matchCommandUpdate') throw new Error('Expected replay update');
    expect(replayed.receipt).toEqual(committedReceipt);
    expect(transcript[1]).toEqual({
      kind: 'close',
      code: 1000,
      reason: 'MATCH_ENDED',
    });
    const afterReplay = await runInDurableObject(battle.stub, (_instance, state) => ({
      assignmentCount: state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM match_seat_assignment`,
      ).one().count,
      tokenCount: state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM match_seat_token`,
      ).one().count,
      commandCount: state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM match_battle_command`,
      ).one().count,
    }));
    expect(afterReplay).toEqual({
      assignmentCount: 0,
      tokenCount: 0,
      commandCount: beforeCommandCount + 1,
    });
  }, 20_000);

  it.each([
    {
      cutpoint: 'afterTerminalFrameSend' as const,
      resetReason: 'MATCH_TERMINAL_POST_SEND_FAILED',
      closeCode: 1006,
    },
    {
      cutpoint: 'afterTerminalSocketsClose' as const,
      resetReason: 'MATCH_TERMINAL_POST_CLOSE_FAILED',
      closeCode: 1000,
    },
  ])('$cutpointの失敗でもterminal updateを先に送りcommitを巻き戻さない', async ({
    cutpoint,
    resetReason,
    closeCode,
  }) => {
    const battle = await startReservedNpcBattle();
    const rolledBack = await runInDurableObject(battle.stub, (instance) =>
      leaveFinalCommandRolledBack(instance as MatchDO, battle.session, battle.id));
    const issued = await battle.stub.issueSeatToken(battle.session);
    expect(issued.state).toBe('issued');
    if (issued.state !== 'issued') throw new Error('Expected issued seat token');
    const socket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    await authenticateBattle(socket, issued.seatToken);
    const transcriptPending = socketTranscriptUntilClose(socket);
    let committedAtCutpoint: {
      lifecycleState: string;
      terminalCommands: number;
      assignments: number;
    } | null = null;

    const interrupted = runInDurableObject(battle.stub, async (instance, state) => {
      const serverSocket = state.getWebSockets().find((candidate) => {
        const attachment = candidate.deserializeAttachment() as { mode?: string } | null;
        return attachment?.mode === 'authenticated';
      });
      if (!serverSocket) throw new Error('Expected authenticated server socket');
      const attachment = serverSocket.deserializeAttachment();
      const target = instance as unknown as {
        afterTerminalFrameSend: () => Promise<void>;
        afterTerminalSocketsClose: () => Promise<void>;
        handleAuthenticatedGameFrame(
          socket: WebSocket,
          attachment: unknown,
          message: string,
        ): Promise<void>;
      };
      target[cutpoint] = async () => {
        committedAtCutpoint = {
          lifecycleState: String(state.storage.sql.exec<SqlRow>(
            `SELECT lifecycle_state FROM match_battle_lifecycle`,
          ).one().lifecycle_state),
          terminalCommands: state.storage.sql.exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM match_battle_command WHERE terminal_flag = 1`,
          ).one().count,
          assignments: state.storage.sql.exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM match_seat_assignment`,
          ).one().count,
        };
        throw new Error(`INJECTED_${cutpoint}`);
      };
      await target.handleAuthenticatedGameFrame(
        serverSocket,
        attachment,
        JSON.stringify({ type: 'matchCommand', command: rolledBack.finalCommand }),
      );
    });
    await expectDurableObjectReset(interrupted, resetReason);
    const recoveredStub = stubFor(battle.id);
    const recovered = await recoveredStub.getNpcBattleLifecycle(battle.session);
    expect(recovered).toMatchObject({
      state: 'finished',
      terminalResult: { kind: 'finished' },
    });
    const durableAfterReset = await runInDurableObject(recoveredStub, (_instance, state) => ({
      lifecycleState: String(state.storage.sql.exec<SqlRow>(
        `SELECT lifecycle_state FROM match_battle_lifecycle`,
      ).one().lifecycle_state),
      terminalCommands: state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM match_battle_command WHERE terminal_flag = 1`,
      ).one().count,
      assignments: state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM match_seat_assignment`,
      ).one().count,
      releases: state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM match_terminal_release`,
      ).one().count,
    }));
    expect(durableAfterReset).toEqual({
      lifecycleState: 'finished',
      terminalCommands: 1,
      assignments: 0,
      releases: 1,
    });
    expect(committedAtCutpoint).toEqual({
      lifecycleState: 'finished',
      terminalCommands: 1,
      assignments: 0,
    });
    const transcript = await transcriptPending;
    const message = transcript.find((outcome) => outcome.kind === 'message');
    if (message?.kind !== 'message') throw new Error('Expected terminal update before reset');
    expect(parseMatchServerFrame(JSON.parse(message.data) as unknown)).toMatchObject({
      type: 'matchCommandUpdate',
      receipt: { state: 'accepted' },
      projection: { terminal: { state: 'finished' }, legalActions: [] },
    });
    expect(transcript.at(-1)).toMatchObject({
      kind: 'close',
      code: closeCode,
    });
  }, 20_000);

  it.each([
    {
      operation: 'cancel' as const,
      terminalState: 'cancelled',
      reason: 'server_cancelled',
    },
    {
      operation: 'abandon' as const,
      terminalState: 'abandoned',
      reason: 'player_abandoned',
    },
  ])('$operation RPCもterminal projection送信後にsocketをcloseする', async ({
    operation,
    terminalState,
    reason,
  }) => {
    const battle = await startReservedNpcBattle();
    const issued = await battle.stub.issueSeatToken(battle.session);
    expect(issued.state).toBe('issued');
    if (issued.state !== 'issued') throw new Error('Expected issued seat token');
    const socket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    await authenticateBattle(socket, issued.seatToken);
    const transcriptPending = socketTranscriptUntilClose(socket);
    const lifecycle = operation === 'cancel'
      ? await battle.stub.cancelNpcBattle({
          principal: battle.session,
          reason: 'server_cancelled',
        })
      : await battle.stub.abandonNpcBattle({
          principal: battle.session,
          reason: 'player_abandoned',
        });
    expect(lifecycle).toMatchObject({ state: terminalState });

    const transcript = await transcriptPending;
    expect(transcript).toHaveLength(2);
    const projectionOutcome = transcript[0];
    if (projectionOutcome?.kind !== 'message') {
      throw new Error('Expected lifecycle terminal projection');
    }
    expect(parseMatchServerFrame(JSON.parse(projectionOutcome.data) as unknown)).toMatchObject({
      type: 'matchProjection',
      projection: {
        phase: expect.not.stringMatching(/^finished$/),
        winner: null,
        endReason: null,
        terminal: { state: terminalState, reason },
        legalActions: [],
      },
    });
    expect(transcript[1]).toEqual({
      kind: 'close',
      code: 1000,
      reason: 'MATCH_ENDED',
    });
  });

  it('session失効後はsocketを閉じ、exact startとbattle commandを盤面不変で拒否する', async () => {
    const battle = await startReservedNpcBattle();
    const issued = await battle.stub.issueSeatToken(battle.session);
    expect(issued.state).toBe('issued');
    if (issued.state !== 'issued') throw new Error('Expected issued seat token');
    const socket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    await authenticateBattle(socket, issued.seatToken);
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

  it('最終transaction失敗は旧activeへrollbackし、exact command再送でfinishedへ収束する', async () => {
    const battle = await startReservedNpcBattle();
    const recovered = await runInDurableObject(battle.stub, async (instance, state) => {
      const rolledBack = await leaveFinalCommandRolledBack(
        instance as MatchDO,
        battle.session,
        battle.id,
      );
      const restart = await (instance as MatchDO).startNpcBattle({
        principal: battle.session,
        seed: battle.seed,
      });
      const active = await (instance as MatchDO).getNpcBattleLifecycle(battle.session);
      const receipt = await (instance as MatchDO).applyNpcBattleCommand({
        principal: battle.session,
        command: rolledBack.finalCommand,
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
      return { rolledBack, restart, active, receipt, lifecycle, tamperedRowError };
    });

    expect(recovered.restart).toEqual({ state: 'ready', created: false });
    expect(recovered.active).toMatchObject({ state: 'active' });
    expect(recovered.receipt).toMatchObject({ state: 'accepted' });
    expect(recovered.tamperedRowError).toBe('MATCH_BATTLE_STATE_INVALID');
    expect(recovered.lifecycle).toMatchObject({
      state: 'finished',
      terminalResult: {
        kind: 'finished',
        finalStateHash: expect.not.stringMatching(
          `^${recovered.rolledBack.beforeFinal.currentStateHash}$`,
        ),
      },
    });
  }, 20_000);

  it('最終transaction失敗後のcancelは旧active checkpointを終端値にする', async () => {
    const battle = await startReservedNpcBattle();
    const recovered = await runInDurableObject(battle.stub, async (instance) => {
      const rolledBack = await leaveFinalCommandRolledBack(
        instance as MatchDO,
        battle.session,
        battle.id,
      );
      const cancelled = await (instance as MatchDO).cancelNpcBattle({
        principal: battle.session,
        reason: 'server_cancelled',
      });
      const lifecycle = await (instance as MatchDO).getNpcBattleLifecycle(battle.session);
      return { cancelled, rolledBack, lifecycle };
    });

    expect(recovered.cancelled).toEqual(recovered.lifecycle);
    expect(recovered.lifecycle).toMatchObject({
      state: 'cancelled',
      terminalResult: {
        kind: 'cancelled',
        finalStateHash: recovered.rolledBack.beforeFinal.currentStateHash,
        appliedActions: recovered.rolledBack.beforeFinal.steps.length,
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
    expect(outbox).toEqual([
      expect.objectContaining({ release_phase: 'reservation_release_pending' }),
    ]);
    await runTerminalCleanupAlarm(reserved.stub);
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
    expect(coexistence.terminalRelease).toEqual([
      expect.objectContaining({ release_phase: 'unregister_pending' }),
    ]);
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
    await runTerminalCleanupAlarm(battle.stub);
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
      const rolledBack = await leaveFinalCommandRolledBack(
        instance as MatchDO,
        battle.session,
        battle.id,
      );
      const firstReplay = await (instance as MatchDO).applyNpcBattleCommand({
        principal: battle.session,
        command: rolledBack.finalCommand,
      });
      const secondReplay = await (instance as MatchDO).applyNpcBattleCommand({
        principal: battle.session,
        command: rolledBack.finalCommand,
      });
      const lifecycle = await (instance as MatchDO).getNpcBattleLifecycle(battle.session);
      return { rolledBack, firstReplay, secondReplay, lifecycle };
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
        finalStateHash: expect.not.stringMatching(
          `^${recovered.rolledBack.beforeFinal.currentStateHash}$`,
        ),
      },
    });
  }, 20_000);
});

describe('OLG-125 MatchDO battle persistence and crash recovery', () => {
  it('activation transaction途中失敗を全battle行rollbackし、同じstartで一組だけ生成する', async () => {
    const battle = await reserveNpcBattle();
    const rolledBack = await runInDurableObject(battle.stub, async (instance, state) => {
      const target = instance as unknown as {
        writePreparedBattleSteps: (...args: unknown[]) => void;
      };
      const original = target.writePreparedBattleSteps.bind(instance);
      target.writePreparedBattleSteps = (...args) => {
        original(...args);
        throw new Error('INJECTED_ACTIVATION_STEP_WRITE_FAILURE');
      };
      let errorMessage: string | null = null;
      try {
        await (instance as MatchDO).startNpcBattle({
          principal: battle.session,
          seed: battle.seed,
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      } finally {
        target.writePreparedBattleSteps = original;
      }
      return {
        errorMessage,
        lifecycle: state.storage.sql.exec<SqlRow>(
          `SELECT lifecycle_state, persistence_version FROM match_battle_lifecycle`,
        ).one(),
        counts: state.storage.sql.exec<SqlRow>(
          `SELECT
             (SELECT COUNT(*) FROM match_battle_manifest) AS manifests,
             (SELECT COUNT(*) FROM match_battle_state) AS states,
             (SELECT COUNT(*) FROM match_battle_command) AS commands,
             (SELECT COUNT(*) FROM match_battle_step) AS steps,
             (SELECT COUNT(*) FROM match_battle_event) AS events`,
        ).one(),
      };
    });
    expect(rolledBack).toEqual({
      errorMessage: 'INJECTED_ACTIVATION_STEP_WRITE_FAILURE',
      lifecycle: { lifecycle_state: 'provisioning', persistence_version: null },
      counts: { manifests: 0, states: 0, commands: 0, steps: 0, events: 0 },
    });

    await expect(
      battle.stub.startNpcBattle({ principal: battle.session, seed: battle.seed }),
    ).resolves.toEqual({ state: 'ready', created: false });
    const beforeEviction = await battle.stub.getNpcBattleSnapshot(battle.session);
    const stored = await runInDurableObject(battle.stub, (_instance, state) => ({
      lifecycle: state.storage.sql.exec<SqlRow>(
        `SELECT lifecycle_state, persistence_version FROM match_battle_lifecycle`,
      ).one(),
      counts: state.storage.sql.exec<SqlRow>(
        `SELECT
           (SELECT COUNT(*) FROM match_battle_manifest) AS manifests,
           (SELECT COUNT(*) FROM match_battle_state) AS states,
           (SELECT COUNT(*) FROM match_battle_command) AS commands,
           (SELECT COUNT(*) FROM match_battle_step) AS steps,
           (SELECT COUNT(*) FROM match_battle_event) AS events`,
      ).one(),
      current: state.storage.sql.exec<SqlRow>(
        `SELECT step_count, event_count FROM match_battle_state`,
      ).one(),
    }));
    expect(stored.lifecycle).toEqual({ lifecycle_state: 'active', persistence_version: 1 });
    expect(stored.counts).toMatchObject({ manifests: 1, states: 1, commands: 0 });
    expect(stored.counts.steps).toBe(stored.current.step_count);
    expect(stored.counts.events).toBe(stored.current.event_count);
    await evictDurableObject(battle.stub);
    await expect(battle.stub.getNpcBattleSnapshot(battle.session)).resolves.toEqual(beforeEviction);
  });

  it('activation commit後・memory install前のcutpointがctx.abortでDOを強制resetする', async () => {
    const battle = await reserveNpcBattle();
    await failNextBattlePersistenceCutpoint(
      battle.stub,
      'afterBattleActivationCommit',
      'INJECTED_AFTER_ACTIVATION_COMMIT',
    );
    await expectDurableObjectReset(
      battle.stub.startNpcBattle({ principal: battle.session, seed: battle.seed }),
      'MATCH_BATTLE_POST_ACTIVATION_COMMIT_FAILED',
    );
  });

  it('terminal commit後もpending socketのws-auth deadlineを残しalarmでcloseする', async () => {
    const battle = await startReservedNpcBattle();
    const socket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    const closed = socketOutcome(socket);
    await battle.stub.cancelNpcBattle({
      principal: battle.session,
      reason: 'server_cancelled',
    });
    const pending = await runInDurableObject(battle.stub, async (_instance, state) => {
      const serverSocket = state.getWebSockets()[0];
      if (!serverSocket) throw new Error('Expected pending server socket');
      const attachment = serverSocket.deserializeAttachment() as TestPendingAttachment;
      const dueAt = Date.now() - 1;
      serverSocket.serializeAttachment({ ...attachment, authDeadlineEpochMs: dueAt });
      state.storage.sql.exec(
        `UPDATE do_deadline SET due_at_ms = ?
          WHERE deadline_key = ? AND deadline_kind = 'ws-auth'`,
        dueAt,
        `ws-auth:${attachment.connectionId}`,
      );
      return {
        wsDeadlines: state.storage.sql.exec<{ count: number }>(
          `SELECT COUNT(*) AS count FROM do_deadline WHERE deadline_kind = 'ws-auth'`,
        ).one().count,
        terminalDeadlines: state.storage.sql.exec<{ count: number }>(
          `SELECT COUNT(*) AS count FROM do_deadline
            WHERE deadline_kind = 'coordinator-terminal-release'`,
        ).one().count,
      };
    });
    expect(pending).toEqual({ wsDeadlines: 1, terminalDeadlines: 1 });
    await runInDurableObject(battle.stub, async (instance, state) => {
      await state.storage.setAlarm(Date.now() + 60_000);
      await (instance as MatchDO).alarm();
    });
    await expect(closed).resolves.toEqual({
      kind: 'close',
      code: 1008,
      reason: 'AUTH_FAILED',
    });
  });

  it('accepted/rejected receipt・stable step/event・snapshotを復旧しexact再送へ収束する', async () => {
    const battle = await startReservedNpcBattle();
    const before = await battle.stub.getNpcBattleSnapshot(battle.session);
    const future = npcCommand(battle.id, 1, { type: 'endPlay' });
    const invalid = npcCommand(battle.id, 0, { type: 'endPlay', extra: true });
    const futureReceipt = await battle.stub.applyNpcBattleCommand({
      principal: battle.session,
      command: future,
    });
    const invalidReceipt = await battle.stub.applyNpcBattleCommand({
      principal: battle.session,
      command: invalid,
    });
    const action = stableHumanAction(
      before,
      searchAi({ keepHand: 2 }).choose(before.state as BattleState, HUMAN_PLAYER),
    );
    const acceptedCommand = npcCommand(battle.id, 0, action);
    const acceptedReceipt = await battle.stub.applyNpcBattleCommand({
      principal: battle.session,
      command: acceptedCommand,
    });
    expect(acceptedReceipt).toMatchObject({ state: 'accepted', revision: 1 });
    const after = await battle.stub.getNpcBattleSnapshot(battle.session);

    const stored = await runInDurableObject(battle.stub, (_instance, state) => ({
      current: state.storage.sql.exec<SqlRow>(
        `SELECT revision, step_count, event_count, command_count, rejection_count,
                current_state_hash, current_identity_hash
           FROM match_battle_state`,
      ).one(),
      commands: state.storage.sql.exec<SqlRow>(
        `SELECT record_sequence, command_id, expected_revision, result_state,
                result_revision, canonical_payload, payload_digest, receipt_json
           FROM match_battle_command ORDER BY record_sequence`,
      ).toArray(),
      humanSteps: state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM match_battle_step WHERE source = 'human'`,
      ).one().count,
      sequenceBounds: state.storage.sql.exec<SqlRow>(
        `SELECT COUNT(*) AS count, MIN(event_sequence) AS first,
                MAX(event_sequence) AS last FROM match_battle_event`,
      ).one(),
    }));
    expect(stored.current).toMatchObject({
      revision: 1,
      command_count: 3,
      rejection_count: 2,
      current_state_hash: after.currentStateHash,
      current_identity_hash: after.currentIdentityHash,
    });
    expect(stored.commands.map((row) => row.result_state)).toEqual([
      'rejected',
      'rejected',
      'accepted',
    ]);
    expect(stored.commands.every((row) => /^[0-9a-f]{64}$/.test(String(row.payload_digest))))
      .toBe(true);
    expect(stored.commands.every((row) => String(row.canonical_payload).startsWith('[')))
      .toBe(true);
    expect(stored.commands.every((row) => String(row.receipt_json).startsWith('{')))
      .toBe(true);
    expect(stored.humanSteps).toBe(1);
    expect(stored.sequenceBounds).toEqual({
      count: stored.current.event_count,
      first: 0,
      last: Number(stored.current.event_count) - 1,
    });

    await evictDurableObject(battle.stub);
    await expect(battle.stub.getNpcBattleSnapshot(battle.session)).resolves.toEqual(after);
    await expect(
      battle.stub.applyNpcBattleCommand({ principal: battle.session, command: future }),
    ).resolves.toEqual(futureReceipt);
    await expect(
      battle.stub.applyNpcBattleCommand({ principal: battle.session, command: invalid }),
    ).resolves.toEqual(invalidReceipt);
    await expect(
      battle.stub.applyNpcBattleCommand({ principal: battle.session, command: acceptedCommand }),
    ).resolves.toEqual(acceptedReceipt);
    await expect(
      battle.stub.applyNpcBattleCommand({
        principal: battle.session,
        command: npcCommand(
          battle.id,
          1,
          acceptedCommand.action,
          acceptedCommand.commandId,
        ),
      }),
    ).resolves.toMatchObject({
      state: 'rejected',
      errorCode: 'MATCH_COMMAND_ID_CONFLICT',
      originalRevision: 1,
    });

    const nextAction = stableHumanAction(
      after,
      searchAi({ keepHand: 2 }).choose(after.state as BattleState, HUMAN_PLAYER),
    );
    await expect(
      battle.stub.applyNpcBattleCommand({
        principal: battle.session,
        command: npcCommand(battle.id, 1, nextAction),
      }),
    ).resolves.toMatchObject({ state: 'accepted', revision: 2 });
  });

  it('accepted/rejectedのtransaction途中失敗を全行rollbackし、同じIDを再試行できる', async () => {
    const battle = await startReservedNpcBattle();
    const before = await battle.stub.getNpcBattleSnapshot(battle.session);
    const acceptedCommand = npcCommand(
      battle.id,
      0,
      stableHumanAction(
        before,
        searchAi({ keepHand: 2 }).choose(before.state as BattleState, HUMAN_PLAYER),
      ),
    );
    const acceptedRollback = await runInDurableObject(battle.stub, async (instance, state) => {
      const target = instance as unknown as {
        writePreparedBattleSteps: (...args: unknown[]) => void;
      };
      const original = target.writePreparedBattleSteps.bind(instance);
      target.writePreparedBattleSteps = (...args) => {
        original(...args);
        throw new Error('INJECTED_STEP_WRITE_FAILURE');
      };
      let errorMessage: string | null = null;
      try {
        await (instance as MatchDO).applyNpcBattleCommand({
          principal: battle.session,
          command: acceptedCommand,
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      } finally {
        target.writePreparedBattleSteps = original;
      }
      return {
        errorMessage,
        snapshot: await (instance as MatchDO).getNpcBattleSnapshot(battle.session),
        state: state.storage.sql.exec<SqlRow>(
          `SELECT revision, command_count, rejection_count FROM match_battle_state`,
        ).one(),
        commands: state.storage.sql.exec<SqlRow>(`SELECT * FROM match_battle_command`).toArray(),
      };
    });
    expect(acceptedRollback).toEqual({
      errorMessage: 'INJECTED_STEP_WRITE_FAILURE',
      snapshot: before,
      state: { revision: 0, command_count: 0, rejection_count: 0 },
      commands: [],
    });
    await expect(
      battle.stub.applyNpcBattleCommand({ principal: battle.session, command: acceptedCommand }),
    ).resolves.toMatchObject({ state: 'accepted', revision: 1 });

    const afterAccepted = await battle.stub.getNpcBattleSnapshot(battle.session);
    const rejectedCommand = npcCommand(battle.id, 1, { type: 'endPlay', extra: true });
    const rejectedRollback = await runInDurableObject(battle.stub, async (instance, state) => {
      const target = instance as unknown as {
        writeCommandRecord: (...args: unknown[]) => void;
      };
      const original = target.writeCommandRecord.bind(instance);
      target.writeCommandRecord = (...args) => {
        original(...args);
        throw new Error('INJECTED_RECEIPT_WRITE_FAILURE');
      };
      let errorMessage: string | null = null;
      try {
        await (instance as MatchDO).applyNpcBattleCommand({
          principal: battle.session,
          command: rejectedCommand,
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      } finally {
        target.writeCommandRecord = original;
      }
      return {
        errorMessage,
        snapshot: await (instance as MatchDO).getNpcBattleSnapshot(battle.session),
        state: state.storage.sql.exec<SqlRow>(
          `SELECT revision, command_count, rejection_count FROM match_battle_state`,
        ).one(),
      };
    });
    expect(rejectedRollback).toEqual({
      errorMessage: 'INJECTED_RECEIPT_WRITE_FAILURE',
      snapshot: afterAccepted,
      state: { revision: 1, command_count: 1, rejection_count: 0 },
    });
    await expect(
      battle.stub.applyNpcBattleCommand({ principal: battle.session, command: rejectedCommand }),
    ).resolves.toMatchObject({
      state: 'rejected',
      errorCode: 'MATCH_ACTION_INVALID',
      revision: 1,
    });
  });

  it('accepted commit後・runtime install前のcutpointがctx.abortでDOを強制resetする', async () => {
    const battle = await startReservedNpcBattle();
    const before = await battle.stub.getNpcBattleSnapshot(battle.session);
    const command = npcCommand(
      battle.id,
      0,
      stableHumanAction(
        before,
        searchAi({ keepHand: 2 }).choose(before.state as BattleState, HUMAN_PLAYER),
      ),
    );
    await failNextBattlePersistenceCutpoint(
      battle.stub,
      'afterBattleCommandCommit',
      'INJECTED_AFTER_ACCEPTED_COMMIT',
    );
    await expectDurableObjectReset(
      battle.stub.applyNpcBattleCommand({ principal: battle.session, command }),
      'MATCH_COMMAND_POST_COMMIT_FAILED',
    );
  });

  it('accepted runtime swap後・ACK前のctx.abortも永続状態へ収束させる', async () => {
    const battle = await startReservedNpcBattle();
    const before = await battle.stub.getNpcBattleSnapshot(battle.session);
    const command = npcCommand(
      battle.id,
      0,
      stableHumanAction(
        before,
        searchAi({ keepHand: 2 }).choose(before.state as BattleState, HUMAN_PLAYER),
      ),
    );
    await failNextBattlePersistenceCutpoint(
      battle.stub,
      'afterBattleCommandInstall',
      'INJECTED_AFTER_ACCEPTED_INSTALL',
    );
    await expectDurableObjectReset(
      battle.stub.applyNpcBattleCommand({ principal: battle.session, command }),
      'MATCH_COMMAND_POST_INSTALL_FAILED',
    );
  });

  it('rejected receiptのcache install後・ACK前のcutpointがctx.abortでDOを強制resetする', async () => {
    const battle = await startReservedNpcBattle();
    const command = npcCommand(battle.id, 1, { type: 'endPlay' });
    await failNextBattlePersistenceCutpoint(
      battle.stub,
      'afterBattleCommandInstall',
      'INJECTED_AFTER_REJECTED_INSTALL',
    );
    await expectDurableObjectReset(
      battle.stub.applyNpcBattleCommand({ principal: battle.session, command }),
      'MATCH_COMMAND_POST_INSTALL_FAILED',
    );
  });

  it('SQLite commit成功後にbattleCommands.rememberが例外を投げてもctx.abortでDOを強制resetする', async () => {
    const battle = await startReservedNpcBattle();
    const command = npcCommand(battle.id, 1, { type: 'endPlay' });
    const interrupted = runInDurableObject(battle.stub, async (instance) => {
      const target = instance as unknown as {
        battleCommands: { remember: (...args: unknown[]) => unknown };
      };
      target.battleCommands.remember = () => {
        throw new Error('INJECTED_LEDGER_REMEMBER_FAILURE');
      };
      await (instance as MatchDO).applyNpcBattleCommand({
        principal: battle.session,
        command,
      });
    });
    await expectDurableObjectReset(
      interrupted,
      'MATCH_COMMAND_CACHE_INSTALL_FAILED',
    );
  });

  it('prepareHumanActionのBATTLE_ACTION_INVALID以外のEngineBattleAdapterErrorはMATCH_BATTLE_STATE_INVALIDへ変換する', async () => {
    const battle = await startReservedNpcBattle();
    const before = await battle.stub.getNpcBattleSnapshot(battle.session);
    const command = npcCommand(
      battle.id,
      0,
      stableHumanAction(
        before,
        searchAi({ keepHand: 2 }).choose(before.state as BattleState, HUMAN_PLAYER),
      ),
    );
    const errorMessage = await runInDurableObject(battle.stub, async (instance) => {
      const target = instance as unknown as {
        battleRuntime: { prepareHumanAction: (...args: unknown[]) => unknown } | null;
      };
      if (!target.battleRuntime) throw new Error('Expected active battle runtime');
      const original = target.battleRuntime.prepareHumanAction;
      target.battleRuntime.prepareHumanAction = () => {
        throw new EngineBattleAdapterError('BATTLE_RUNTIME_INVALID');
      };
      try {
        await (instance as MatchDO).applyNpcBattleCommand({
          principal: battle.session,
          command,
        });
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      } finally {
        target.battleRuntime.prepareHumanAction = original;
      }
    });
    expect(errorMessage).toBe('MATCH_BATTLE_STATE_INVALID');
  });

  it('final runtime install後・ACK前のcutpointがctx.abortでDOを強制resetする', async () => {
    const battle = await startReservedNpcBattle();
    const rolledBack = await runInDurableObject(battle.stub, (instance) =>
      leaveFinalCommandRolledBack(instance as MatchDO, battle.session, battle.id));
    await failNextBattlePersistenceCutpoint(
      battle.stub,
      'afterBattleCommandInstall',
      'INJECTED_AFTER_TERMINAL_INSTALL',
    );
    await expectDurableObjectReset(
      battle.stub.applyNpcBattleCommand({
        principal: battle.session,
        command: rolledBack.finalCommand,
      }),
      'MATCH_COMMAND_POST_INSTALL_FAILED',
    );
  }, 20_000);

  it('acceptedのcommit済み・memory未反映状態をrequest終了後のevictionからexact復旧する', async () => {
    const battle = await startReservedNpcBattle();
    const before = await battle.stub.getNpcBattleSnapshot(battle.session);
    const command = npcCommand(
      battle.id,
      0,
      stableHumanAction(
        before,
        searchAi({ keepHand: 2 }).choose(before.state as BattleState, HUMAN_PLAYER),
      ),
    );
    const interrupted = await runInDurableObject(battle.stub, async (instance, state) => {
      const target = instance as unknown as {
        installCommittedCommandResult: (...args: unknown[]) => unknown;
      };
      const original = target.installCommittedCommandResult.bind(instance);
      target.installCommittedCommandResult = () => {
        throw new Error('INJECTED_BEFORE_RUNTIME_INSTALL');
      };
      let errorMessage: string | null = null;
      try {
        await (instance as MatchDO).applyNpcBattleCommand({
          principal: battle.session,
          command,
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      } finally {
        target.installCommittedCommandResult = original;
      }
      const memory = instance as unknown as {
        battleRevision: number;
        battleRuntime: { commandRevision(): number };
      };
      return {
        errorMessage,
        memoryRevision: memory.battleRevision,
        runtimeRevision: memory.battleRuntime.commandRevision(),
        durable: state.storage.sql.exec<SqlRow>(
          `SELECT revision, command_count FROM match_battle_state`,
        ).one(),
      };
    });
    expect(interrupted).toEqual({
      errorMessage: 'INJECTED_BEFORE_RUNTIME_INSTALL',
      memoryRevision: 0,
      runtimeRevision: 0,
      durable: { revision: 1, command_count: 1 },
    });
    await evictDurableObject(battle.stub);
    const replay = await battle.stub.applyNpcBattleCommand({ principal: battle.session, command });
    expect(replay).toMatchObject({ state: 'accepted', baseRevision: 0, revision: 1 });
    const after = await battle.stub.getNpcBattleSnapshot(battle.session);
    expect(after.currentStateHash).not.toBe(before.currentStateHash);
    const counts = await runInDurableObject(battle.stub, (_instance, state) => ({
      accepted: state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM match_battle_command WHERE result_state = 'accepted'`,
      ).one().count,
      humanSteps: state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM match_battle_step WHERE source = 'human'`,
      ).one().count,
    }));
    expect(counts).toEqual({ accepted: 1, humanSteps: 1 });
  });

  it('rejectedのcommit済み・cache未反映状態をrequest終了後のevictionから復旧する', async () => {
    const battle = await startReservedNpcBattle();
    const before = await battle.stub.getNpcBattleSnapshot(battle.session);
    const command = npcCommand(battle.id, 1, { type: 'endPlay' });
    await runInDurableObject(battle.stub, async (instance) => {
      const target = instance as unknown as {
        installCommittedCommandResult: (...args: unknown[]) => unknown;
      };
      const original = target.installCommittedCommandResult.bind(instance);
      target.installCommittedCommandResult = () => {
        throw new Error('INJECTED_BEFORE_RECEIPT_CACHE_INSTALL');
      };
      try {
        await (instance as MatchDO).applyNpcBattleCommand({
          principal: battle.session,
          command,
        });
      } catch (error) {
        expect(error).toEqual(new Error('INJECTED_BEFORE_RECEIPT_CACHE_INSTALL'));
      } finally {
        target.installCommittedCommandResult = original;
      }
    });
    await evictDurableObject(battle.stub);
    await expect(
      battle.stub.applyNpcBattleCommand({ principal: battle.session, command }),
    ).resolves.toMatchObject({
      state: 'rejected',
      errorCode: 'MATCH_REVISION_MISMATCH',
      relation: 'ahead',
      revision: 0,
    });
    await expect(battle.stub.getNpcBattleSnapshot(battle.session)).resolves.toEqual(before);
  });

  it('finalのcommit済み・memory未反映状態をrequest終了後のevictionから復旧する', async () => {
    const battle = await startReservedNpcBattle();
    const rolledBack = await runInDurableObject(battle.stub, (instance) =>
      leaveFinalCommandRolledBack(instance as MatchDO, battle.session, battle.id));
    await runInDurableObject(battle.stub, async (instance) => {
      const target = instance as unknown as {
        installCommittedCommandResult: (...args: unknown[]) => unknown;
      };
      const original = target.installCommittedCommandResult.bind(instance);
      target.installCommittedCommandResult = () => {
        throw new Error('INJECTED_BEFORE_TERMINAL_RUNTIME_INSTALL');
      };
      try {
        await (instance as MatchDO).applyNpcBattleCommand({
          principal: battle.session,
          command: rolledBack.finalCommand,
        });
      } catch (error) {
        expect(error).toEqual(new Error('INJECTED_BEFORE_TERMINAL_RUNTIME_INSTALL'));
      } finally {
        target.installCommittedCommandResult = original;
      }
    });
    await evictDurableObject(battle.stub);

    const replay = await battle.stub.applyNpcBattleCommand({
      principal: battle.session,
      command: rolledBack.finalCommand,
    });
    expect(replay).toMatchObject({ state: 'accepted' });
    await expect(battle.stub.getNpcBattleLifecycle(battle.session)).resolves.toMatchObject({
      state: 'finished',
      terminalResult: { kind: 'finished' },
    });
    const durable = await runInDurableObject(battle.stub, (_instance, state) => ({
      terminalCommands: state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM match_battle_command WHERE terminal_flag = 1`,
      ).one().count,
      releases: state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM match_terminal_release`,
      ).one().count,
      deadlines: state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM do_deadline
          WHERE deadline_kind = 'coordinator-terminal-release'`,
      ).one().count,
    }));
    expect(durable).toEqual({ terminalCommands: 1, releases: 1, deadlines: 1 });
  }, 20_000);

  it('terminal releaseとdeadlineの片残りをconstructor gateで拒否する', async () => {
    const battle = await startReservedNpcBattle();
    await battle.stub.cancelNpcBattle({
      principal: battle.session,
      reason: 'server_cancelled',
    });
    await runInDurableObject(battle.stub, (_instance, state) => {
      state.storage.sql.exec(
        `DELETE FROM do_deadline WHERE deadline_kind = 'coordinator-terminal-release'`,
      );
    });
    await evictDurableObject(battle.stub);
    await expect(stubFor(battle.id).getNpcBattleLifecycle(battle.session))
      .rejects.toThrow('MATCH_BATTLE_PERSISTENCE_INVALID');
  });

  it('terminal後の未知commandIdは台帳capacity exhaustionをDO errorとして伝播する', async () => {
    const battle = await startReservedNpcBattle();
    await expect(battle.stub.cancelNpcBattle({
      principal: battle.session,
      reason: 'server_cancelled',
    })).resolves.toMatchObject({ state: 'cancelled' });

    const command = npcCommand(battle.id, 0, { type: 'unknown' });
    await runInDurableObject(battle.stub, async (instance) => {
      const target = instance as unknown as {
        battleCommands: { hasCapacity: () => boolean };
        applyNpcBattleCommandExclusive(input: {
          principal: MatchSessionPrincipal;
          command: MatchCommandCandidate;
        }): Promise<unknown>;
      };
      target.battleCommands.hasCapacity = () => false;
      await expect(target.applyNpcBattleCommandExclusive({
        principal: battle.session,
        command,
      })).rejects.toThrow('MATCH_COMMAND_CAPACITY_EXCEEDED');
    });
  });

  it('terminal後の未知commandId再送を繰り返しても台帳recordsは増えない', async () => {
    const battle = await startReservedNpcBattle();
    await expect(battle.stub.cancelNpcBattle({
      principal: battle.session,
      reason: 'server_cancelled',
    })).resolves.toMatchObject({ state: 'cancelled' });

    const before = await runInDurableObject(battle.stub, (instance) => {
      const target = instance as unknown as { battleCommands: { size: number } };
      return target.battleCommands.size;
    });

    for (let i = 0; i < 5; i += 1) {
      const command = npcCommand(battle.id, 0, { type: 'unknown' });
      await expect(battle.stub.applyNpcBattleCommand({
        principal: battle.session,
        command,
      })).resolves.toMatchObject({
        state: 'rejected',
        errorCode: 'MATCH_ALREADY_TERMINAL',
      });
    }

    const after = await runInDurableObject(battle.stub, (instance) => {
      const target = instance as unknown as { battleCommands: { size: number } };
      return target.battleCommands.size;
    });
    expect(after).toBe(before);
  });

  it('runtime無しcancelledに残ったstale assignmentをconstructor gateで拒否する', async () => {
    const battle = await reserveNpcBattle();
    await runInDurableObject(battle.stub, async (instance) => {
      const target = instance as unknown as {
        assignSeatExclusive: (...args: unknown[]) => Promise<{ state: 'conflict' }>;
      };
      const original = target.assignSeatExclusive.bind(instance);
      target.assignSeatExclusive = async () => ({ state: 'conflict' });
      try {
        await expect((instance as MatchDO).startNpcBattle({
          principal: battle.session,
          seed: battle.seed,
        })).resolves.toEqual({ state: 'conflict' });
      } finally {
        target.assignSeatExclusive = original;
      }
    });
    const cancelled = await battle.stub.cancelNpcBattle({
      principal: battle.session,
      reason: 'start_failed',
    });
    expect(cancelled.terminalResult).toMatchObject({
      kind: 'cancelled',
      turns: null,
      finalStateHash: null,
      appliedActions: null,
    });
    await evictDurableObject(battle.stub);
    await expect(battle.stub.getNpcBattleLifecycle(battle.session)).resolves.toEqual(cancelled);

    await runInDurableObject(battle.stub, (_instance, state) => {
      const now = Date.now();
      state.storage.sql.exec(
        `INSERT INTO match_seat_assignment (
           seat_id, account_id, session_id, session_version, assignment_version,
           coordinator_registration_id, coordinator_registration_epoch_ms, updated_at_ms
         ) VALUES ('player-1', ?, ?, ?, 1, ?, ?, ?)`,
        battle.session.accountId,
        battle.session.sessionId,
        battle.session.sessionVersion,
        crypto.randomUUID(),
        now,
        now,
      );
    });
    await evictDurableObject(battle.stub);
    await expect(stubFor(battle.id).getNpcBattleLifecycle(battle.session))
      .rejects.toThrow('MATCH_BATTLE_PERSISTENCE_INVALID');
  });

  it.each([
    ['command digest', `UPDATE match_battle_command SET payload_digest = '${'0'.repeat(64)}'`],
    ['stable step gap', `DELETE FROM match_battle_step WHERE step_sequence = 0`],
    ['revision/human count', `UPDATE match_battle_state SET revision = revision + 1`],
    ['current state hash', `UPDATE match_battle_state SET current_state_hash = '${'0'.repeat(16)}'`],
    [
      'active terminal release/deadline pair',
      `INSERT INTO match_terminal_release (
         seat_id, registration_id, registration_epoch_ms, account_id, session_id,
         session_version, match_id, seed, release_phase, retry_attempt
       ) SELECT 'player-1', '00000000-0000-4000-8000-000000000000', 1,
                account_id, session_id, session_version, match_id, seed,
                'unregister_pending', 0
           FROM match_battle_lifecycle;
       INSERT INTO do_deadline (deadline_key, deadline_kind, due_at_ms)
       VALUES ('coordinator-terminal-release:00000000-0000-4000-8000-000000000000',
               'coordinator-terminal-release', 1)`,
    ],
    [
      'receipt exact schema',
      `UPDATE match_battle_command
          SET receipt_json = substr(receipt_json, 1, length(receipt_json) - 1) || ',"extra":true}'`,
    ],
  ])('%s改変は実constructor gateで繰り返しfail closedにする', async (_label, mutation) => {
    const battle = await startReservedNpcBattle();
    const before = await battle.stub.getNpcBattleSnapshot(battle.session);
    const command = npcCommand(
      battle.id,
      0,
      stableHumanAction(
        before,
        searchAi({ keepHand: 2 }).choose(before.state as BattleState, HUMAN_PLAYER),
      ),
    );
    await battle.stub.applyNpcBattleCommand({ principal: battle.session, command });
    const persisted = await runInDurableObject(battle.stub, (_instance, state) => {
      state.storage.sql.exec(mutation);
      return {
        lifecycle: state.storage.sql.exec<SqlRow>(
          `SELECT lifecycle_state, persistence_version FROM match_battle_lifecycle`,
        ).one(),
        current: state.storage.sql.exec<SqlRow>(
          `SELECT revision, command_count FROM match_battle_state`,
        ).one(),
      };
    });
    expect(persisted).toEqual({
      lifecycle: { lifecycle_state: 'active', persistence_version: 1 },
      current: { revision: mutation.includes('revision = revision + 1') ? 2 : 1, command_count: 1 },
    });
    await evictDurableObject(battle.stub);
    await expect(stubFor(battle.id).getNpcBattleSnapshot(battle.session))
      .rejects.toThrow('MATCH_BATTLE_PERSISTENCE_INVALID');
    await expect(stubFor(battle.id).getNpcBattleSnapshot(battle.session))
      .rejects.toThrow('MATCH_BATTLE_PERSISTENCE_INVALID');
  });
});

describe('OLG-126 MatchDO reconnect and recovery reads', () => {
  it('legacy authはinitial snapshot、resumeはcurrent/1手前/aheadをdeltaまたはfallbackへ収束させる', async () => {
    const battle = await startReservedNpcBattle();
    const issued = await battle.stub.issueSeatToken(battle.session);
    expect(issued.state).toBe('issued');
    if (issued.state !== 'issued') throw new Error('Expected issued seat token');

    const socket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    const initial = await authenticateBattle(socket, issued.seatToken);
    expect(initial.sync).toEqual({
      type: 'matchViewerSync',
      mode: 'snapshot',
      reason: 'initial',
      eventSequence: initial.projection.eventSequence,
    });
    expect(initial.projection).toMatchObject({
      projectionVersion: MATCH_PLAYER_PROJECTION_VERSION,
      viewerEventVersion: MATCH_VIEWER_EVENT_VERSION,
    });

    const action = initial.projection.legalActions[0];
    if (!action) throw new Error('Expected a legal player action');
    const commandPending = socketOutcome(socket);
    socket.send(JSON.stringify({
      type: 'matchCommand',
      command: npcCommand(battle.id, initial.projection.revision, action),
    }));
    const commandOutcome = await commandPending;
    if (commandOutcome.kind !== 'message') throw new Error('Expected command update');
    const update = parseMatchServerFrame(JSON.parse(commandOutcome.data) as unknown);
    if (update?.type !== 'matchCommandUpdate') throw new Error('Expected command update frame');
    const currentSequence = update.projection.eventSequence;
    expect(currentSequence).toBeGreaterThan(initial.projection.eventSequence);

    const persistedCounts = await runInDurableObject(battle.stub, (_instance, state) =>
      state.storage.sql.exec<{ step_count: number; event_count: number }>(
        `SELECT step_count, event_count FROM match_battle_state`,
      ).one());
    expect(persistedCounts.step_count).toBe(currentSequence);
    expect(persistedCounts.event_count).toBeGreaterThan(persistedCounts.step_count);
    expect(currentSequence).not.toBe(persistedCounts.event_count);
    socket.close(1000, 'done');

    const reconnect = async (lastEventSequence: number) => {
      const fresh = await battle.stub.issueSeatToken(battle.session);
      expect(fresh.state).toBe('issued');
      if (fresh.state !== 'issued') throw new Error('Expected fresh seat token');
      const resumedSocket = await openPlayerSocket(battle.stub, battle.id, battle.session);
      const frame = await resumeBattle(resumedSocket, fresh.seatToken, lastEventSequence);
      return { socket: resumedSocket, frame };
    };

    const atCurrent = await reconnect(currentSequence);
    expect(atCurrent.frame.sync).toEqual({
      type: 'matchViewerSync',
      mode: 'delta',
      afterEventSequence: currentSequence,
      batches: [],
    });
    atCurrent.socket.close(1000, 'done');

    const oneBehind = await reconnect(currentSequence - 1);
    expect(oneBehind.frame.sync).toEqual({
      type: 'matchViewerSync',
      mode: 'delta',
      afterEventSequence: currentSequence - 1,
      batches: [{ sequence: currentSequence, events: expect.any(Array) }],
    });
    oneBehind.socket.close(1000, 'done');

    const ahead = await reconnect(currentSequence + 1);
    expect(ahead.frame.sync).toEqual({
      type: 'matchViewerSync',
      mode: 'snapshot',
      reason: 'cursor_ahead',
      eventSequence: currentSequence,
    });
    ahead.socket.close(1000, 'done');

    const gapSequence = await runInDurableObject(battle.stub, (instance) => {
      const target = instance as unknown as {
        battleSteps: unknown[];
        battleProjectionCheckpoint: AuthoritativeBattleCheckpoint | null;
      };
      if (!target.battleProjectionCheckpoint) {
        throw new Error('Expected projection checkpoint');
      }
      const eventSequence = MAX_MATCH_RESUME_EVENT_BATCHES + 1;
      // gap判定はbatchをmaterializeする前に行うため、長大な履歴を作らず境界だけを検査する。
      target.battleSteps = Array.from({ length: eventSequence }, () => ({}));
      target.battleProjectionCheckpoint = {
        ...target.battleProjectionCheckpoint,
        stepCount: eventSequence,
      };
      return eventSequence;
    });
    const gap = await reconnect(0);
    expect(gap.frame.sync).toEqual({
      type: 'matchViewerSync',
      mode: 'snapshot',
      reason: 'cursor_gap',
      eventSequence: gapSequence,
    });
    gap.socket.close(1000, 'done');
  });

  it('DO eviction後に新しいseat tokenとcurrent cursorで復帰し、次commandを継続する', async () => {
    const battle = await startReservedNpcBattle();
    const firstIssued = await battle.stub.issueSeatToken(battle.session);
    expect(firstIssued.state).toBe('issued');
    if (firstIssued.state !== 'issued') throw new Error('Expected issued seat token');
    const firstSocket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    const initial = await authenticateBattle(firstSocket, firstIssued.seatToken);
    const firstAction = initial.projection.legalActions[0];
    if (!firstAction) throw new Error('Expected a legal player action');

    const firstPending = socketOutcome(firstSocket);
    firstSocket.send(JSON.stringify({
      type: 'matchCommand',
      command: npcCommand(battle.id, initial.projection.revision, firstAction),
    }));
    const firstOutcome = await firstPending;
    if (firstOutcome.kind !== 'message') throw new Error('Expected command update');
    const firstUpdate = parseMatchServerFrame(JSON.parse(firstOutcome.data) as unknown);
    if (firstUpdate?.type !== 'matchCommandUpdate') {
      throw new Error('Expected exact command update frame');
    }
    firstSocket.close(1000, 'done');
    await evictDurableObject(battle.stub);

    const freshIssued = await battle.stub.issueSeatToken(battle.session);
    expect(freshIssued.state).toBe('issued');
    if (freshIssued.state !== 'issued') throw new Error('Expected fresh seat token after eviction');
    expect(freshIssued.seatToken).not.toBe(firstIssued.seatToken);
    const resumedSocket = await openPlayerSocket(battle.stub, battle.id, battle.session);
    const resumed = await resumeBattle(
      resumedSocket,
      freshIssued.seatToken,
      firstUpdate.projection.eventSequence,
    );
    expect(resumed.projection).toEqual(firstUpdate.projection);
    expect(resumed.sync).toEqual({
      type: 'matchViewerSync',
      mode: 'delta',
      afterEventSequence: firstUpdate.projection.eventSequence,
      batches: [],
    });

    const nextAction = resumed.projection.legalActions[0];
    if (!nextAction) throw new Error('Expected a legal action after resume');
    const nextPending = socketOutcome(resumedSocket);
    resumedSocket.send(JSON.stringify({
      type: 'matchCommand',
      command: npcCommand(battle.id, resumed.projection.revision, nextAction),
    }));
    const nextOutcome = await nextPending;
    if (nextOutcome.kind !== 'message') throw new Error('Expected resumed command update');
    const nextUpdate = parseMatchServerFrame(JSON.parse(nextOutcome.data) as unknown);
    expect(nextUpdate).toMatchObject({
      type: 'matchCommandUpdate',
      receipt: {
        state: 'accepted',
        baseRevision: resumed.projection.revision,
        revision: resumed.projection.revision + 1,
      },
      projection: { revision: resumed.projection.revision + 1 },
      sync: {
        type: 'matchViewerSync',
        mode: 'delta',
        afterEventSequence: resumed.projection.eventSequence,
      },
    });
    if (nextUpdate?.type !== 'matchCommandUpdate') {
      throw new Error('Expected exact resumed command update frame');
    }
    expect(nextUpdate.projection.eventSequence).toBeGreaterThan(
      resumed.projection.eventSequence,
    );
    resumedSocket.close(1000, 'done');
  });

  it('ACK喪失時のreceiptとterminal public resultをcleanup・eviction後もsession所有者へ返す', async () => {
    const battle = await startReservedNpcBattle();
    const rolledBack = await runInDurableObject(battle.stub, (instance) =>
      leaveFinalCommandRolledBack(instance as MatchDO, battle.session, battle.id));

    // browserへACKを配送しないままcommandだけをcommitした状況を再現する。
    const committedReceipt = await battle.stub.applyNpcBattleCommand({
      principal: battle.session,
      command: rolledBack.finalCommand,
    });
    expect(committedReceipt).toMatchObject({
      state: 'accepted',
      commandId: rolledBack.finalCommand.commandId,
    });
    await expect(battle.stub.getNpcBattleReceipt({
      principal: battle.session,
      commandId: rolledBack.finalCommand.commandId,
    })).resolves.toEqual(committedReceipt);
    await expect(battle.stub.getNpcBattleReceipt({
      principal: battle.session,
      commandId: nextCommandId(),
    })).resolves.toBeNull();

    const publicResult = await battle.stub.getNpcBattlePublicResult(battle.session);
    expect(publicResult).toMatchObject({ state: 'finished' });
    expect(publicResult).not.toHaveProperty('turns');
    expect(publicResult).not.toHaveProperty('finalStateHash');
    expect(publicResult).not.toHaveProperty('appliedActions');
    expect(JSON.stringify(publicResult)).not.toContain(String(battle.seed));

    await runTerminalCleanupAlarm(battle.stub);
    await expect(battle.coordinator.checkNpcMatchRecoveryOwnership({
      ...battle.session,
      matchId: battle.id,
    })).resolves.toEqual({ state: 'authorized' });
    await evictDurableObject(battle.stub);

    await expect(battle.stub.getNpcBattleRecoveryStatus(battle.session)).resolves.toEqual({
      state: 'terminal',
      matchId: battle.id,
    });
    await expect(battle.stub.getNpcBattleReceipt({
      principal: battle.session,
      commandId: rolledBack.finalCommand.commandId,
    })).resolves.toEqual(committedReceipt);
    await expect(battle.stub.getNpcBattlePublicResult(battle.session)).resolves.toEqual(publicResult);
  }, 20_000);
});
