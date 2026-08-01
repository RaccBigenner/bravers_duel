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
  const matchStub = vi.fn(
    (_bindings: MatchAccessBindings, _matchId: string) => ({
      issueSeatToken,
      fetch: fetchMatch,
    }),
  );
  const dependencies = {
    publicPortEnabled,
    createStore,
    matchStub,
  } satisfies MatchAccessDependencies;

  return {
    handle: createMatchAccessRequestHandler(dependencies),
    createStore,
    issueSeatToken,
    fetchMatch,
    matchStub,
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

describe('OLG-113 match access controller', () => {
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
    expect(flow.matchStub).not.toHaveBeenCalled();
    expect(flow.issueSeatToken).not.toHaveBeenCalled();
    expect(flow.fetchMatch).not.toHaveBeenCalled();
  });

  it('public port無効時は通常seat/WSを404にし、local exact smokeだけをDOへ通す', async () => {
    const flow = testFlow(fakeStore(), false);

    const seat = await flow.handle(seatRequest(), localBindings());
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
    expect(socket?.status).toBe(404);
    expect(nearSmoke?.status).toBe(404);
    expect(remoteSmoke?.status).toBe(404);
    expect(exactSmoke?.status).toBe(204);
    expect(flow.createStore).not.toHaveBeenCalled();
    expect(flow.matchStub).toHaveBeenCalledTimes(1);
    expect(flow.matchStub).toHaveBeenCalledWith(expect.anything(), 'local-smoke');
    expect(flow.fetchMatch).toHaveBeenCalledTimes(1);
    expect(flow.issueSeatToken).not.toHaveBeenCalled();
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

  it('assignment成功時だけraw seat tokenを201/no-storeで返し他credentialを露出しない', async () => {
    const store = fakeStore({
      resolveSessionCandidates: vi.fn(async () => principal),
    });
    const flow = testFlow(store);
    const expiresAtEpochMs = Date.parse('2026-08-01T09:00:30.000Z');
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
      expiresAt: '2026-08-01T09:00:30.000Z',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(SESSION_TOKEN);
    expect(serialized).not.toContain(ACCOUNT_ID);
    expect(serialized).not.toContain(SESSION_ID);
    expect(serialized).not.toContain(String(localBindings().SESSION_HMAC_KEYS));
    expect(flow.issueSeatToken).toHaveBeenCalledWith(principal);
    expect(flow.createStore.mock.invocationCallOrder[0]).toBeLessThan(
      flow.matchStub.mock.invocationCallOrder[0]!,
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
