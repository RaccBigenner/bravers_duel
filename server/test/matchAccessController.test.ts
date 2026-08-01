import { describe, expect, it, vi } from 'vitest';
import { generateOpaqueToken } from '../src/auth/sessionCrypto';
import type {
  SessionPrincipal,
  SessionStore,
  SessionStoreCredential,
} from '../src/auth/supabaseSessionStore';
import {
  AUTH_CLIENT_HEADER,
  AUTH_CLIENT_HEADER_VALUE,
} from '../src/http/authRequest';
import {
  createMatchAccessRequestHandler,
  type MatchAccessBindings,
  type MatchAccessDependencies,
} from '../src/http/matchAccessController';
import {
  INTERNAL_ACCOUNT_ID_HEADER,
  INTERNAL_SESSION_ID_HEADER,
  INTERNAL_SESSION_VERSION_HEADER,
  type MatchSessionPrincipal,
  type SeatTokenIssueResult,
} from '../src/match/matchDurableObject';
import type {
  SessionCoordinatorPort,
  SessionMatchMembershipStatus,
  SessionNpcMatchReservationResult,
} from '../src/session/sessionCoordinatorDurableObject';

type TestNpcBattleStartResult =
  | { state: 'ready'; created: boolean }
  | { state: 'conflict' }
  | { state: 'unavailable' };

const ORIGIN = 'http://127.0.0.1:8787';
const REMOTE_ORIGIN = 'https://play.racc.games';
const ACCOUNT_ID = '33333333-4444-4555-8666-777777777777';
const SESSION_ID = '44444444-5555-4666-8777-888888888888';
const SPOOF_ACCOUNT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SPOOF_SESSION_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

const opaqueToken = (byte: number) =>
  generateOpaqueToken((bytes) => {
    bytes.fill(byte);
    return bytes;
  });

const SESSION_TOKEN = opaqueToken(8);
const SEAT_TOKEN = opaqueToken(9);

function keyring(keyVersion: number, byte: number): string {
  return JSON.stringify({
    activeVersion: keyVersion,
    keys: [{ keyVersion, material: opaqueToken(byte) }],
  });
}

function localBindings(): MatchAccessBindings {
  return {
    APP_ENV: 'local',
    APP_ORIGIN: ORIGIN,
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_AUTH_KEY: 'sb_publishable_local-test',
    SUPABASE_SECRET_KEY: 'sb_secret_local-test',
    SESSION_HMAC_KEYS: keyring(1, 1),
    SESSION_ENCRYPTION_KEYS: keyring(2, 2),
  };
}

function remoteBindings(): MatchAccessBindings {
  return {
    ...localBindings(),
    APP_ENV: 'production',
    APP_ORIGIN: REMOTE_ORIGIN,
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_AUTH_KEY: 'sb_secret_remote-auth',
    SUPABASE_SECRET_KEY: 'sb_secret_remote-store',
  };
}

const principal: SessionPrincipal = {
  sessionId: SESSION_ID,
  accountId: ACCOUNT_ID,
  sessionVersion: 3,
  credentialState: 'CURRENT',
  credentialKeyVersion: 1,
  idleExpiresAt: '2026-10-30T00:00:00Z',
  absoluteExpiresAt: '2027-08-01T00:00:00Z',
};

const matchPrincipal: MatchSessionPrincipal = {
  sessionId: SESSION_ID,
  accountId: ACCOUNT_ID,
  sessionVersion: 3,
};

function fakeStore(overrides: Partial<SessionStore> = {}): SessionStore {
  return {
    createBootstrap: vi.fn(async () => ({ attemptId: SESSION_ID })),
    claimBootstrap: vi.fn(async () => ({ state: 'invalid' } as const)),
    claimBootstrapCandidates: vi.fn(async () => ({ state: 'invalid' } as const)),
    releaseBootstrapClaim: vi.fn(async () => true),
    resetBootstrapAfterAuthDelete: vi.fn(async () => false),
    completeGuestSession: vi.fn(async () => ({ state: 'invalid' } as const)),
    resolveSession: vi.fn(async () => null),
    resolveSessionCandidates: vi.fn(async () => null),
    validateSessionVersion: vi.fn(async () => false),
    revokeSession: vi.fn(async () => null),
    ...overrides,
  };
}

function testFlow(
  store = fakeStore(),
  publicPortEnabled = true,
) {
  const createStore = vi.fn(
    (_credential: SessionStoreCredential, _signal: AbortSignal) => store,
  );
  const issueSeatToken = vi.fn(
    async (_resolved: MatchSessionPrincipal): Promise<SeatTokenIssueResult> => ({
      state: 'not_assigned',
    }),
  );
  const fetchMatch = vi.fn(
    async (_request: Request): Promise<Response> => new Response(null, { status: 204 }),
  );
  const startNpcBattle = vi.fn(async (): Promise<TestNpcBattleStartResult> => ({
    state: 'ready' as const,
    created: true,
  }));
  const checkMatchMembership = vi.fn(
    async (): Promise<SessionMatchMembershipStatus> => ({ state: 'registered' }),
  );
  const reserveNpcMatch = vi.fn(async (): Promise<SessionNpcMatchReservationResult> => ({
    state: 'reserved' as const,
    matchId: 'npc-11111111-2222-4333-8444-555555555555',
    seed: 0x1234_5678,
    created: true,
  }));
  const coordinator = {
    registerMatch: vi.fn(),
    checkMatch: vi.fn(),
    checkMatchMembership,
    reserveNpcMatch,
    releaseNpcMatch: vi.fn(),
    unregisterMatch: vi.fn(),
    prepareLogout: vi.fn(),
    confirmLogout: vi.fn(),
    invalidateSession: vi.fn(),
  } as unknown as SessionCoordinatorPort;
  const coordinatorStub = vi.fn(
    (_bindings: MatchAccessBindings, _sessionId: string) => coordinator,
  );
  const matchStub = vi.fn(
    (_bindings: MatchAccessBindings, _matchId: string) => ({
      issueSeatToken,
      startNpcBattle,
      fetch: fetchMatch,
    }),
  );
  const dependencies = {
    publicPortEnabled,
    createStore,
    coordinatorStub,
    matchStub,
  } satisfies MatchAccessDependencies;

  return {
    handle: createMatchAccessRequestHandler(dependencies),
    createStore,
    issueSeatToken,
    startNpcBattle,
    fetchMatch,
    matchStub,
    coordinatorStub,
    checkMatchMembership,
    reserveNpcMatch,
  };
}

interface SeatRequestOptions {
  path?: string;
  origin?: string | null;
  fetchSite?: string | null;
  clientHeader?: string | null;
  contentType?: string | null;
  cookie?: string;
  body?: BodyInit;
  extraHeaders?: HeadersInit;
}

function seatRequest(options: SeatRequestOptions = {}): Request {
  const headers = new Headers(options.extraHeaders);
  if (options.origin !== null) headers.set('Origin', options.origin ?? ORIGIN);
  if (options.fetchSite !== null) {
    headers.set('Sec-Fetch-Site', options.fetchSite ?? 'same-origin');
  }
  if (options.clientHeader !== null) {
    headers.set(AUTH_CLIENT_HEADER, options.clientHeader ?? AUTH_CLIENT_HEADER_VALUE);
  }
  if (options.contentType !== null) {
    headers.set('Content-Type', options.contentType ?? 'application/json');
  }
  if (options.cookie) headers.set('Cookie', options.cookie);
  return new Request(`${ORIGIN}${options.path ?? '/matches/battle_1/seat-token'}`, {
    method: 'POST',
    headers,
    body: options.body ?? '{}',
  });
}

function npcStartRequest(options: SeatRequestOptions = {}): Request {
  return seatRequest({ ...options, path: options.path ?? '/matches/npc' });
}

interface WebSocketRequestOptions {
  path?: string;
  origin?: string | null;
  fetchSite?: string | null;
  upgrade?: string | null;
  cookie?: string;
  extraHeaders?: HeadersInit;
  requestOrigin?: string;
}

function webSocketRequest(options: WebSocketRequestOptions = {}): Request {
  const origin = options.requestOrigin ?? ORIGIN;
  const headers = new Headers(options.extraHeaders);
  if (options.origin !== null) headers.set('Origin', options.origin ?? origin);
  if (options.fetchSite !== null) {
    headers.set('Sec-Fetch-Site', options.fetchSite ?? 'same-origin');
  }
  if (options.upgrade !== null) headers.set('Upgrade', options.upgrade ?? 'websocket');
  if (options.cookie) headers.set('Cookie', options.cookie);
  return new Request(`${origin}${options.path ?? '/matches/battle_1/ws'}`, {
    method: 'GET',
    headers,
  });
}

describe('OLG-113/121 match access controller', () => {
  it('Origin/Fetch Metadata/header/body/queryをDB・DOより先に拒否する', async () => {
    const flow = testFlow();
    const cases: Array<[string, Request, number]> = [
      ['Origin欠損', seatRequest({ origin: null }), 403],
      ['別Origin', seatRequest({ origin: 'https://evil.example' }), 403],
      ['cross-site', seatRequest({ fetchSite: 'cross-site' }), 403],
      ['固定header欠損', seatRequest({ clientHeader: null }), 403],
      ['非JSON', seatRequest({ contentType: 'text/plain' }), 403],
      ['query付きseat route', seatRequest({ path: '/matches/battle_1/seat-token?seat=1' }), 403],
      ['client指定seat', seatRequest({ body: '{"seat":"player-1"}' }), 400],
      ['object以外', seatRequest({ body: '[]' }), 400],
      ['body上限超過', seatRequest({ body: 'a'.repeat(4_097) }), 413],
      ['NPC戦のclient指定seed', npcStartRequest({ body: '{"seed":1}' }), 400],
      ['NPC戦のclient指定deck', npcStartRequest({ body: '{"deck":[]}' }), 400],
      ['NPC戦のclient指定matchId', npcStartRequest({ body: '{"matchId":"chosen"}' }), 400],
      ['NPC戦のclient指定version', npcStartRequest({ body: '{"version":"old"}' }), 400],
      ['query付きNPC戦開始', npcStartRequest({ path: '/matches/npc?matchId=chosen' }), 403],
      [
        'query付きWebSocket',
        webSocketRequest({ path: '/matches/battle_1/ws?seatToken=raw' }),
        403,
      ],
      ['別Origin WebSocket', webSocketRequest({ origin: 'https://evil.example' }), 403],
      ['cross-site WebSocket', webSocketRequest({ fetchSite: 'cross-site' }), 403],
    ];

    for (const [label, request, status] of cases) {
      const response = await flow.handle(request, localBindings());
      expect(response?.status, label).toBe(status);
    }
    expect(flow.createStore).not.toHaveBeenCalled();
    expect(flow.coordinatorStub).not.toHaveBeenCalled();
    expect(flow.matchStub).not.toHaveBeenCalled();
    expect(flow.issueSeatToken).not.toHaveBeenCalled();
    expect(flow.startNpcBattle).not.toHaveBeenCalled();
    expect(flow.fetchMatch).not.toHaveBeenCalled();
  });

  it('public port無効時は通常seat/WSを404にし、local exact smokeだけをDOへ通す', async () => {
    const flow = testFlow(fakeStore(), false);

    const seat = await flow.handle(seatRequest(), localBindings());
    const start = await flow.handle(npcStartRequest(), localBindings());
    const socket = await flow.handle(webSocketRequest(), localBindings());
    const nearSmoke = await flow.handle(
      webSocketRequest({ path: '/matches/local-smoke2/ws' }),
      localBindings(),
    );
    const remoteSmoke = await flow.handle(
      webSocketRequest({
        path: '/matches/local-smoke/ws',
        requestOrigin: REMOTE_ORIGIN,
      }),
      remoteBindings(),
    );
    const exactSmoke = await flow.handle(
      webSocketRequest({ path: '/matches/local-smoke/ws' }),
      localBindings(),
    );

    expect(seat?.status).toBe(404);
    expect(start?.status).toBe(404);
    expect(socket?.status).toBe(404);
    expect(nearSmoke?.status).toBe(404);
    expect(remoteSmoke?.status).toBe(404);
    expect(exactSmoke?.status).toBe(204);
    expect(flow.createStore).not.toHaveBeenCalled();
    expect(flow.coordinatorStub).not.toHaveBeenCalled();
    expect(flow.matchStub).toHaveBeenCalledTimes(1);
    expect(flow.matchStub).toHaveBeenCalledWith(expect.anything(), 'local-smoke');
    expect(flow.fetchMatch).toHaveBeenCalledTimes(1);
    expect(flow.issueSeatToken).not.toHaveBeenCalled();
    expect(flow.startNpcBattle).not.toHaveBeenCalled();
  });

  it('NPC戦開始はserver予約のmatch ID/seedだけを使い、応答へmatch ID以外を出さない', async () => {
    const store = fakeStore({
      resolveSessionCandidates: vi.fn(async () => principal),
    });
    const flow = testFlow(store);
    const request = () => npcStartRequest({
      cookie: `bd_session_local=${SESSION_TOKEN}`,
      body: '{}',
    });

    const created = await flow.handle(request(), localBindings());
    flow.startNpcBattle.mockResolvedValueOnce({ state: 'ready', created: false });
    const retried = await flow.handle(request(), localBindings());

    const expectedMatchId = 'npc-11111111-2222-4333-8444-555555555555';
    expect(created?.status).toBe(201);
    expect(retried?.status).toBe(200);
    expect(await created?.json()).toEqual({ matchId: expectedMatchId });
    expect(await retried?.json()).toEqual({ matchId: expectedMatchId });
    expect(flow.reserveNpcMatch).toHaveBeenCalledTimes(2);
    expect(flow.reserveNpcMatch).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      accountId: ACCOUNT_ID,
      sessionVersion: 3,
    });
    expect(flow.matchStub).toHaveBeenCalledWith(expect.anything(), expectedMatchId);
    expect(flow.startNpcBattle).toHaveBeenCalledWith({
      principal: matchPrincipal,
      seed: 0x1234_5678,
    });
    expect(flow.createStore.mock.invocationCallOrder[0]).toBeLessThan(
      flow.coordinatorStub.mock.invocationCallOrder[0]!,
    );
    expect(flow.coordinatorStub.mock.invocationCallOrder[0]).toBeLessThan(
      flow.reserveNpcMatch.mock.invocationCallOrder[0]!,
    );
    expect(flow.reserveNpcMatch.mock.invocationCallOrder[0]).toBeLessThan(
      flow.matchStub.mock.invocationCallOrder[0]!,
    );
    expect(flow.matchStub.mock.invocationCallOrder[0]).toBeLessThan(
      flow.startNpcBattle.mock.invocationCallOrder[0]!,
    );
    const serialized = JSON.stringify(await (await flow.handle(request(), localBindings()))?.json());
    expect(serialized).not.toContain(String(0x1234_5678));
    expect(serialized).not.toContain(ACCOUNT_ID);
    expect(serialized).not.toContain(SESSION_ID);
  });

  it('NPC予約の失効・競合とMatchDO runtime欠落を一般化して返す', async () => {
    const store = fakeStore({
      resolveSessionCandidates: vi.fn(async () => principal),
    });

    const invalidated = testFlow(store);
    invalidated.reserveNpcMatch.mockResolvedValue({
      state: 'invalidated',
      invalidatedVersion: 4,
    });
    const invalidatedResponse = await invalidated.handle(
      npcStartRequest({ cookie: `bd_session_local=${SESSION_TOKEN}` }),
      localBindings(),
    );
    expect(invalidatedResponse?.status).toBe(401);
    expect(invalidatedResponse?.headers.get('Set-Cookie')).toContain('bd_session_local=;');
    expect(invalidated.matchStub).not.toHaveBeenCalled();

    const conflict = testFlow(store);
    conflict.reserveNpcMatch.mockResolvedValue({ state: 'conflict' });
    const conflictResponse = await conflict.handle(
      npcStartRequest({ cookie: `bd_session_local=${SESSION_TOKEN}` }),
      localBindings(),
    );
    expect(conflictResponse?.status).toBe(409);
    expect(await conflictResponse?.json()).toEqual({ error: 'MATCH_START_CONFLICT' });
    expect(conflict.matchStub).not.toHaveBeenCalled();

    const unavailableFlow = testFlow(store);
    unavailableFlow.startNpcBattle.mockResolvedValue({ state: 'unavailable' });
    const unavailableResponse = await unavailableFlow.handle(
      npcStartRequest({ cookie: `bd_session_local=${SESSION_TOKEN}` }),
      localBindings(),
    );
    expect(unavailableResponse?.status).toBe(503);
    expect(await unavailableResponse?.json()).toEqual({ error: 'MATCH_STATE_UNAVAILABLE' });

    const malformedReservation = testFlow(store);
    malformedReservation.reserveNpcMatch.mockResolvedValue({
      state: 'reserved',
      matchId: 'client-chosen',
      seed: -1,
      created: true,
    } as never);
    const malformedReservationResponse = await malformedReservation.handle(
      npcStartRequest({ cookie: `bd_session_local=${SESSION_TOKEN}` }),
      localBindings(),
    );
    expect(malformedReservationResponse?.status).toBe(503);
    expect(malformedReservation.matchStub).not.toHaveBeenCalled();

    const malformedStart = testFlow(store);
    malformedStart.startNpcBattle.mockResolvedValue({
      state: 'ready',
      created: 'yes',
    } as never);
    const malformedStartResponse = await malformedStart.handle(
      npcStartRequest({ cookie: `bd_session_local=${SESSION_TOKEN}` }),
      localBindings(),
    );
    expect(malformedStartResponse?.status).toBe(503);
    expect(await malformedStartResponse?.json()).toEqual({ error: 'MATCH_ACCESS_UNAVAILABLE' });
  });

  it('enabled時もmissing/invalid/revoked/ambiguous sessionをassignment前に拒否する', async () => {
    const noCookie = testFlow();
    const missing = await noCookie.handle(seatRequest(), localBindings());
    expect(missing?.status).toBe(401);
    expect(missing?.headers.get('Set-Cookie')).toBeNull();
    expect(noCookie.createStore).not.toHaveBeenCalled();
    expect(noCookie.matchStub).not.toHaveBeenCalled();

    const invalidCookie = testFlow();
    const invalid = await invalidCookie.handle(
      seatRequest({ cookie: 'bd_session_local=not-an-opaque-token' }),
      localBindings(),
    );
    expect(invalid?.status).toBe(401);
    expect(invalid?.headers.get('Set-Cookie')).toContain('bd_session_local=;');
    expect(invalidCookie.createStore).not.toHaveBeenCalled();
    expect(invalidCookie.matchStub).not.toHaveBeenCalled();

    const revokedStore = fakeStore({ resolveSessionCandidates: vi.fn(async () => null) });
    const revokedFlow = testFlow(revokedStore);
    const revoked = await revokedFlow.handle(
      seatRequest({ cookie: `bd_session_local=${SESSION_TOKEN}` }),
      localBindings(),
    );
    expect(revoked?.status).toBe(401);
    expect(revoked?.headers.get('Set-Cookie')).toContain('bd_session_local=;');
    expect(revokedFlow.createStore).toHaveBeenCalledOnce();
    expect(revokedFlow.matchStub).not.toHaveBeenCalled();

    const ambiguousStore = fakeStore({
      resolveSessionCandidates: vi.fn(async () => ({ state: 'ambiguous' } as const)),
    });
    const ambiguousFlow = testFlow(ambiguousStore);
    const ambiguous = await ambiguousFlow.handle(
      seatRequest({ cookie: `bd_session_local=${SESSION_TOKEN}` }),
      localBindings(),
    );
    expect(ambiguous?.status).toBe(503);
    expect(await ambiguous?.json()).toEqual({ error: 'SESSION_INTEGRITY_FAILURE' });
    expect(ambiguousFlow.matchStub).not.toHaveBeenCalled();
  });

  it.each([
    ['seat-token', () => seatRequest({ cookie: `bd_session_local=${SESSION_TOKEN}` })],
    ['WebSocket', () => webSocketRequest({ cookie: `bd_session_local=${SESSION_TOKEN}` })],
  ])('%sはmembership registered確認前にMatchDO stubを取得しない', async (_label, request) => {
    const store = fakeStore({
      resolveSessionCandidates: vi.fn(async () => principal),
    });

    const missing = testFlow(store);
    missing.checkMatchMembership.mockResolvedValue({ state: 'missing' });
    const missingResponse = await missing.handle(request(), localBindings());
    expect(missingResponse?.status).toBe(404);
    expect(missing.matchStub).not.toHaveBeenCalled();

    const invalidated = testFlow(store);
    invalidated.checkMatchMembership.mockResolvedValue({
      state: 'invalidated',
      invalidatedVersion: 4,
    });
    const invalidatedResponse = await invalidated.handle(request(), localBindings());
    expect(invalidatedResponse?.status).toBe(401);
    expect(invalidatedResponse?.headers.get('Set-Cookie')).toContain('bd_session_local=;');
    expect(invalidated.matchStub).not.toHaveBeenCalled();

    const failed = testFlow(store);
    failed.checkMatchMembership.mockRejectedValue(new Error('coordinator unavailable'));
    const failedResponse = await failed.handle(request(), localBindings());
    expect(failedResponse?.status).toBe(503);
    expect(await failedResponse?.json()).toEqual({ error: 'MATCH_ACCESS_UNAVAILABLE' });
    expect(failed.matchStub).not.toHaveBeenCalled();

    const malformed = testFlow(store);
    malformed.checkMatchMembership.mockResolvedValue({ state: 'unknown' } as never);
    const malformedResponse = await malformed.handle(request(), localBindings());
    expect(malformedResponse?.status).toBe(503);
    expect(await malformedResponse?.json()).toEqual({ error: 'MATCH_ACCESS_UNAVAILABLE' });
    expect(malformed.matchStub).not.toHaveBeenCalled();
  });

  it('assignment成功時だけraw seat tokenを201/no-storeで返し他credentialを露出しない', async () => {
    const store = fakeStore({
      resolveSessionCandidates: vi.fn(async () => principal),
    });
    const flow = testFlow(store);
    const expiresAtEpochMs = Date.now() + 30_000;
    flow.issueSeatToken.mockResolvedValue({
      state: 'issued',
      seatToken: SEAT_TOKEN,
      expiresAtEpochMs,
    });

    const response = await flow.handle(
      seatRequest({ cookie: `bd_session_local=${SESSION_TOKEN}` }),
      localBindings(),
    );
    const body = await response?.json();

    expect(response?.status).toBe(201);
    expect(response?.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response?.headers.get('Pragma')).toBe('no-cache');
    expect(response?.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response?.headers.get('Set-Cookie')).toBeNull();
    expect(body).toEqual({
      seatToken: SEAT_TOKEN,
      expiresAt: new Date(expiresAtEpochMs).toISOString(),
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(SESSION_TOKEN);
    expect(serialized).not.toContain(ACCOUNT_ID);
    expect(serialized).not.toContain(SESSION_ID);
    expect(serialized).not.toContain(String(localBindings().SESSION_HMAC_KEYS));
    expect(flow.issueSeatToken).toHaveBeenCalledWith(matchPrincipal);
    expect(flow.createStore.mock.invocationCallOrder[0]).toBeLessThan(
      flow.coordinatorStub.mock.invocationCallOrder[0]!,
    );
    expect(flow.coordinatorStub.mock.invocationCallOrder[0]).toBeLessThan(
      flow.checkMatchMembership.mock.invocationCallOrder[0]!,
    );
    expect(flow.checkMatchMembership.mock.invocationCallOrder[0]).toBeLessThan(
      flow.matchStub.mock.invocationCallOrder[0]!,
    );
    expect(flow.matchStub.mock.invocationCallOrder[0]).toBeLessThan(
      flow.issueSeatToken.mock.invocationCallOrder[0]!,
    );
  });

  it('assignment不一致は404、発行上限は429 + Retry-Afterへ写す', async () => {
    const store = fakeStore({
      resolveSessionCandidates: vi.fn(async () => principal),
    });
    const flow = testFlow(store);
    flow.issueSeatToken
      .mockResolvedValueOnce({ state: 'not_assigned' })
      .mockResolvedValueOnce({ state: 'rate_limited' });

    const notAssigned = await flow.handle(
      seatRequest({ cookie: `bd_session_local=${SESSION_TOKEN}` }),
      localBindings(),
    );
    const rateLimited = await flow.handle(
      seatRequest({ cookie: `bd_session_local=${SESSION_TOKEN}` }),
      localBindings(),
    );

    expect(notAssigned?.status).toBe(404);
    expect(await notAssigned?.json()).toEqual({ error: 'MATCH_NOT_AVAILABLE' });
    expect(notAssigned?.headers.get('Set-Cookie')).toBeNull();
    expect(rateLimited?.status).toBe(429);
    expect(rateLimited?.headers.get('Retry-After')).toBe('1');
    expect(await rateLimited?.json()).toEqual({ error: 'MATCH_ACCESS_RATE_LIMITED' });

    flow.issueSeatToken.mockResolvedValue({ state: 'unknown' } as never);
    const unknown = await flow.handle(
      seatRequest({ cookie: `bd_session_local=${SESSION_TOKEN}` }),
      localBindings(),
    );
    expect(unknown?.status).toBe(503);
    expect(await unknown?.json()).toEqual({ error: 'MATCH_ACCESS_UNAVAILABLE' });

    flow.issueSeatToken.mockResolvedValue({
      state: 'issued',
      seatToken: 'not-an-opaque-token',
      expiresAtEpochMs: Date.now() + 30_000,
    });
    const malformed = await flow.handle(
      seatRequest({ cookie: `bd_session_local=${SESSION_TOKEN}` }),
      localBindings(),
    );
    expect(malformed?.status).toBe(503);
    expect(JSON.stringify(await malformed?.json())).not.toContain('not-an-opaque-token');
  });

  it('WebSocketはbrowser custom header不要で、外部credential/spoofを捨ててresolved principalだけ渡す', async () => {
    const store = fakeStore({
      resolveSessionCandidates: vi.fn(async () => principal),
    });
    const flow = testFlow(store);
    const external = webSocketRequest({
      cookie: `bd_session_local=${SESSION_TOKEN}`,
      // Safari等がFetch Metadataを送らない場合もexact Originで保護する。
      fetchSite: null,
      extraHeaders: {
        Authorization: 'Bearer browser-controlled',
        'X-Forwarded-For': '203.0.113.99',
        [INTERNAL_ACCOUNT_ID_HEADER]: SPOOF_ACCOUNT_ID,
        [INTERNAL_SESSION_ID_HEADER]: SPOOF_SESSION_ID,
        [INTERNAL_SESSION_VERSION_HEADER]: '999',
      },
    });
    expect(external.headers.get(AUTH_CLIENT_HEADER)).toBeNull();

    const response = await flow.handle(external, localBindings());
    expect(response?.status).toBe(204);
    expect(flow.fetchMatch).toHaveBeenCalledOnce();
    expect(flow.issueSeatToken).not.toHaveBeenCalled();
    expect(flow.checkMatchMembership).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      sessionVersion: 3,
      matchId: 'battle_1',
    });
    expect(flow.createStore.mock.invocationCallOrder[0]).toBeLessThan(
      flow.coordinatorStub.mock.invocationCallOrder[0]!,
    );
    expect(flow.coordinatorStub.mock.invocationCallOrder[0]).toBeLessThan(
      flow.checkMatchMembership.mock.invocationCallOrder[0]!,
    );
    expect(flow.checkMatchMembership.mock.invocationCallOrder[0]).toBeLessThan(
      flow.matchStub.mock.invocationCallOrder[0]!,
    );
    expect(flow.matchStub.mock.invocationCallOrder[0]).toBeLessThan(
      flow.fetchMatch.mock.invocationCallOrder[0]!,
    );

    const forwarded = flow.fetchMatch.mock.calls[0]![0];
    expect(forwarded.method).toBe('GET');
    expect(forwarded.url).toBe(`${ORIGIN}/matches/battle_1/ws`);
    expect(forwarded.headers.get('Upgrade')).toBe('websocket');
    expect(forwarded.headers.get(INTERNAL_ACCOUNT_ID_HEADER)).toBe(ACCOUNT_ID);
    expect(forwarded.headers.get(INTERNAL_SESSION_ID_HEADER)).toBe(SESSION_ID);
    expect(forwarded.headers.get(INTERNAL_SESSION_VERSION_HEADER)).toBe('3');
    expect(forwarded.headers.get('Cookie')).toBeNull();
    expect(forwarded.headers.get('Origin')).toBeNull();
    expect(forwarded.headers.get('Sec-Fetch-Site')).toBeNull();
    expect(forwarded.headers.get(AUTH_CLIENT_HEADER)).toBeNull();
    expect(forwarded.headers.get('Authorization')).toBeNull();
    expect(forwarded.headers.get('X-Forwarded-For')).toBeNull();
    expect(forwarded.headers.get(INTERNAL_ACCOUNT_ID_HEADER)).not.toBe(SPOOF_ACCOUNT_ID);
    expect(forwarded.headers.get(INTERNAL_SESSION_ID_HEADER)).not.toBe(SPOOF_SESSION_ID);
  });
});
