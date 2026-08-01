import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { generateOpaqueToken } from '../src/auth/sessionCrypto';
import { GuestAuthError } from '../src/auth/supabaseGuestAuth';
import type {
  BootstrapClaim,
  CompletedSession,
  SessionPrincipal,
  SessionStore,
} from '../src/auth/supabaseSessionStore';
import type { SessionRuntimeBindings } from '../src/auth/sessionRuntimeConfig';
import {
  AUTH_UPSTREAM_TIMEOUT_MS,
  BOOTSTRAP_CLAIM_LEASE_MS,
  createAuthRequestHandler,
  type AuthControllerDependencies,
} from '../src/http/authController';
import { AUTH_CLIENT_HEADER, AUTH_CLIENT_HEADER_VALUE } from '../src/http/authRequest';
import {
  INTERNAL_ACCOUNT_ID_HEADER,
  INTERNAL_SESSION_ID_HEADER,
  INTERNAL_SESSION_VERSION_HEADER,
  type MatchDO,
} from '../src/match/matchDurableObject';
import { sessionCoordinatorStub } from '../src/session/sessionCoordinatorDurableObject';

const ORIGIN = 'http://127.0.0.1:8787';
const ATTEMPT_ID = '11111111-2222-4333-8444-555555555555';
const CLAIM_ID = '22222222-3333-4444-8555-666666666666';
const ACCOUNT_ID = '33333333-4444-4555-8666-777777777777';
const SESSION_ID = '44444444-5555-4666-8777-888888888888';
const ACCESS_TOKEN = 'access-token-must-stay-server-side';
const REFRESH_TOKEN = 'refresh-token-must-stay-server-side';

const opaqueToken = (byte: number) =>
  generateOpaqueToken((bytes) => {
    bytes.fill(byte);
    return bytes;
  });
const BOOTSTRAP_TOKEN = opaqueToken(8);
const SESSION_TOKEN = opaqueToken(9);

function keyring(keyVersion: number, byte: number): string {
  return JSON.stringify({
    activeVersion: keyVersion,
    keys: [{ keyVersion, material: opaqueToken(byte) }],
  });
}

function localBindings(): SessionRuntimeBindings {
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

const principal: SessionPrincipal = {
  sessionId: SESSION_ID,
  accountId: ACCOUNT_ID,
  sessionVersion: 1,
  credentialState: 'CURRENT',
  credentialKeyVersion: 1,
  idleExpiresAt: '2026-10-30T00:00:00Z',
  absoluteExpiresAt: '2027-08-01T00:00:00Z',
};

const createClaim: BootstrapClaim = {
  state: 'create_auth',
  attemptId: ATTEMPT_ID,
  claimId: CLAIM_ID,
  sessionDerivationKeyVersion: 1,
};

const completed: CompletedSession = {
  state: 'session_ready',
  attemptId: ATTEMPT_ID,
  sessionId: SESSION_ID,
  accountId: ACCOUNT_ID,
  sessionVersion: 1,
  idleExpiresAt: principal.idleExpiresAt,
  absoluteExpiresAt: principal.absoluteExpiresAt,
};

function fakeStore(overrides: Partial<SessionStore> = {}): SessionStore {
  return {
    createBootstrap: vi.fn(async () => ({ attemptId: ATTEMPT_ID })),
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

function controller(
  store: SessionStore,
  overrides: Partial<AuthControllerDependencies> = {},
) {
  const createStore = vi.fn(() => store);
  const createPrincipal = vi.fn(async () => ({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    refreshToken: REFRESH_TOKEN,
    expiresAtEpochSeconds: 4_102_444_800,
  }));
  const deletePrincipal = vi.fn(async () => undefined);
  const prepareSessionLogout = vi.fn(async () => ({ state: 'prepared' as const }));
  const confirmSessionLogout = vi.fn(async () => ({
    state: 'acknowledged' as const,
    invalidatedVersion: 2,
    matchedObjects: 0,
  }));
  const dependencies: AuthControllerDependencies = {
    createStore,
    createPrincipal,
    deletePrincipal,
    prepareSessionLogout,
    confirmSessionLogout,
    randomUuid: () => SESSION_ID,
    ...overrides,
  };
  return {
    handle: createAuthRequestHandler(dependencies),
    createStore,
    createPrincipal,
    deletePrincipal,
    prepareSessionLogout,
    confirmSessionLogout,
  };
}

function post(
  path: string,
  body: unknown = {},
  options: { cookie?: string; origin?: string; headers?: HeadersInit } = {},
): Request {
  const headers = new Headers(options.headers);
  headers.set('Origin', options.origin ?? ORIGIN);
  headers.set('Sec-Fetch-Site', 'same-origin');
  headers.set(AUTH_CLIENT_HEADER, AUTH_CLIENT_HEADER_VALUE);
  headers.set('Content-Type', 'application/json');
  if (options.cookie) headers.set('Cookie', options.cookie);
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function nextSocketEvent(
  socket: WebSocket,
): Promise<{ kind: 'message'; data: string } | { kind: 'close'; reason: string }> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
      socket.removeEventListener('error', onError);
    };
    const onMessage = (event: MessageEvent) => {
      cleanup();
      resolve({ kind: 'message', data: String(event.data) });
    };
    const onClose = (event: CloseEvent) => {
      cleanup();
      resolve({ kind: 'close', reason: event.reason });
    };
    const onError = () => {
      cleanup();
      reject(new Error('Unexpected WebSocket error'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket event'));
    }, 2_000);
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose);
    socket.addEventListener('error', onError);
  });
}

function getSession(cookie?: string): Request {
  const headers = new Headers({
    'Sec-Fetch-Site': 'same-origin',
    [AUTH_CLIENT_HEADER]: AUTH_CLIENT_HEADER_VALUE,
  });
  if (cookie) headers.set('Cookie', cookie);
  return new Request(`${ORIGIN}/auth/session`, { headers });
}

function setCookieValues(response: Response): readonly string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? [response.headers.get('Set-Cookie') ?? ''];
}

describe('OLG-113 auth controller', () => {
  it('claim取得遅延+Auth+completeの各deadlineを30秒lease内へ収める', () => {
    expect(AUTH_UPSTREAM_TIMEOUT_MS * 3).toBeLessThan(BOOTSTRAP_CLAIM_LEASE_MS);
  });

  it('security guardとbody schemaを設定・DB・Authより先に拒否する', async () => {
    const flow = controller(fakeStore());
    const rejected = post('/auth/guest', {});
    rejected.headers.delete('Origin');

    const response = await flow.handle(rejected, localBindings());
    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: 'AUTH_REQUEST_REJECTED' });
    expect(flow.createStore).not.toHaveBeenCalled();
    expect(flow.createPrincipal).not.toHaveBeenCalled();

    const badBody = await flow.handle(
      post('/auth/guest', { admin: true }),
      { APP_ENV: 'local', APP_ORIGIN: ORIGIN },
    );
    expect(badBody?.status).toBe(400);
    expect(flow.createStore).not.toHaveBeenCalled();
  });

  it('bootstrapをdigestだけDBへ保存しHttpOnly cookieとして発行する', async () => {
    const createBootstrap = vi.fn<SessionStore['createBootstrap']>(
      async () => ({ attemptId: ATTEMPT_ID }),
    );
    const flow = controller(fakeStore({ createBootstrap }));

    const response = await flow.handle(post('/auth/bootstrap'), localBindings());
    expect(response?.status).toBe(201);
    expect(response?.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response?.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await response?.json()).toEqual({ state: 'bootstrap_ready' });
    expect(createBootstrap).toHaveBeenCalledOnce();
    const input = createBootstrap.mock.calls[0]![0];
    expect(input.bootstrapDigestHex).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(input)).not.toContain('bd_bootstrap_local');
    const cookies = setCookieValues(response!);
    expect(cookies.join('\n')).toContain('bd_bootstrap_local=');
    expect(cookies.join('\n')).toContain('HttpOnly');
  });

  it('guest成功時だけgrantを暗号化保存しsession発行・bootstrap削除する', async () => {
    const claim = vi.fn(async () => createClaim);
    const complete = vi.fn<SessionStore['completeGuestSession']>(async () => completed);
    const resolve = vi.fn(async () => principal);
    const flow = controller(
      fakeStore({
        claimBootstrapCandidates: claim,
        completeGuestSession: complete,
        resolveSessionCandidates: resolve,
      }),
    );

    const response = await flow.handle(
      post('/auth/guest', {}, { cookie: `bd_bootstrap_local=${BOOTSTRAP_TOKEN}` }),
      localBindings(),
    );
    expect(response?.status).toBe(200);
    const body = JSON.stringify(await response?.json());
    const cookies = setCookieValues(response!).join('\n');
    expect(body).not.toContain(ACCESS_TOKEN);
    expect(body).not.toContain(REFRESH_TOKEN);
    expect(body).not.toContain(BOOTSTRAP_TOKEN);
    expect(cookies).not.toContain(ACCESS_TOKEN);
    expect(cookies).not.toContain(REFRESH_TOKEN);
    expect(cookies).toContain('bd_session_local=');
    expect(cookies).toContain('bd_bootstrap_local=;');
    expect(flow.createPrincipal).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
    const completionInput = complete.mock.calls[0]![0];
    expect(completionInput.encryptedGrant.ciphertextHex).not.toContain(ACCESS_TOKEN);
    expect(completionInput.encryptedGrant.ciphertextHex).not.toContain(REFRESH_TOKEN);
    expect(claim).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledOnce();
  });

  it('既存sessionはAuthを呼ばずready、偽sessionはbootstrapへfall throughせず401', async () => {
    const resolveReady = vi.fn(async () => principal);
    const readyFlow = controller(fakeStore({ resolveSessionCandidates: resolveReady }));
    const ready = await readyFlow.handle(
      post('/auth/guest', {}, { cookie: `bd_session_local=${SESSION_TOKEN}` }),
      localBindings(),
    );
    expect(ready?.status).toBe(200);
    expect(setCookieValues(ready!).join('\n')).toContain(`bd_session_local=${SESSION_TOKEN}`);
    expect(readyFlow.createPrincipal).not.toHaveBeenCalled();

    const claim = vi.fn(async () => createClaim);
    const missingFlow = controller(
      fakeStore({ resolveSessionCandidates: vi.fn(async () => null), claimBootstrapCandidates: claim }),
    );
    const missing = await missingFlow.handle(
      post('/auth/guest', {}, {
        cookie: `bd_session_local=${SESSION_TOKEN}; bd_bootstrap_local=${BOOTSTRAP_TOKEN}`,
      }),
      localBindings(),
    );
    expect(missing?.status).toBe(401);
    expect(claim).not.toHaveBeenCalled();
    expect(missingFlow.createPrincipal).not.toHaveBeenCalled();
  });

  it('candidate multi-hitは503、active claimは202 + Retry-After', async () => {
    const ambiguous = controller(
      fakeStore({ resolveSessionCandidates: vi.fn(async () => ({ state: 'ambiguous' } as const)) }),
    );
    const ambiguousResponse = await ambiguous.handle(
      getSession(`bd_session_local=${SESSION_TOKEN}`),
      localBindings(),
    );
    expect(ambiguousResponse?.status).toBe(503);
    expect(await ambiguousResponse?.json()).toEqual({ error: 'SESSION_INTEGRITY_FAILURE' });

    const waiting = controller(
      fakeStore({
        claimBootstrapCandidates: vi.fn(async () => ({
          state: 'pending',
          retryAfterSeconds: 4,
        } as const)),
      }),
    );
    const pendingResponse = await waiting.handle(
      post('/auth/guest', {}, { cookie: `bd_bootstrap_local=${BOOTSTRAP_TOKEN}` }),
      localBindings(),
    );
    expect(pendingResponse?.status).toBe(202);
    expect(pendingResponse?.headers.get('Retry-After')).toBe('4');
    expect(waiting.createPrincipal).not.toHaveBeenCalled();
  });

  it('recover_authはdelete応答を信用せずDB absence確認後も同requestで再signupしない', async () => {
    const reset = vi.fn(async () => true);
    const deletePrincipal = vi.fn(async () => {
      throw new Error('response lost');
    });
    const flow = controller(
      fakeStore({
        claimBootstrapCandidates: vi.fn(async () => ({
          state: 'recover_auth',
          attemptId: ATTEMPT_ID,
          claimId: CLAIM_ID,
          accountId: ACCOUNT_ID,
        } as const)),
        resetBootstrapAfterAuthDelete: reset,
      }),
      { deletePrincipal },
    );

    const response = await flow.handle(
      post('/auth/guest', {}, { cookie: `bd_bootstrap_local=${BOOTSTRAP_TOKEN}` }),
      localBindings(),
    );
    expect(response?.status).toBe(202);
    expect(await response?.json()).toEqual({
      state: 'retry_required',
      captchaRequired: false,
    });
    expect(deletePrincipal).toHaveBeenCalledWith(expect.anything(), ACCOUNT_ID, expect.anything());
    expect(reset).toHaveBeenCalledOnce();
    expect(flow.createPrincipal).not.toHaveBeenCalled();
  });

  it('429だけclaimを安全解放し、未知/曖昧失敗はpendingに保持する', async () => {
    const release = vi.fn(async () => true);
    const rateLimited = controller(
      fakeStore({ claimBootstrapCandidates: vi.fn(async () => createClaim), releaseBootstrapClaim: release }),
      {
        createPrincipal: vi.fn(async () => {
          throw new GuestAuthError('ANONYMOUS_SIGN_IN_REJECTED', true, 429);
        }),
      },
    );
    const limited = await rateLimited.handle(
      post('/auth/guest', {}, { cookie: `bd_bootstrap_local=${BOOTSTRAP_TOKEN}` }),
      localBindings(),
    );
    expect(limited?.status).toBe(429);
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ safeErrorCode: 'AUTH_RATE_LIMITED' }));

    const ambiguous = controller(fakeStore({ claimBootstrapCandidates: vi.fn(async () => createClaim) }), {
      createPrincipal: vi.fn(async () => {
        throw new GuestAuthError('AUTH_UNAVAILABLE', false, 503);
      }),
    });
    const pendingResponse = await ambiguous.handle(
      post('/auth/guest', {}, { cookie: `bd_bootstrap_local=${BOOTSTRAP_TOKEN}` }),
      localBindings(),
    );
    expect(pendingResponse?.status).toBe(202);
  });

  it('complete応答喪失後は台帳を再照会し同じsessionを回収する', async () => {
    const claim = vi
      .fn()
      .mockResolvedValueOnce(createClaim)
      .mockResolvedValueOnce({
        state: 'session_ready',
        attemptId: ATTEMPT_ID,
        sessionId: SESSION_ID,
        accountId: ACCOUNT_ID,
        sessionVersion: 1,
        sessionDerivationKeyVersion: 1,
      });
    const flow = controller(
      fakeStore({
        claimBootstrapCandidates: claim,
        completeGuestSession: vi.fn(async () => {
          throw new Error('response lost after commit');
        }),
        resolveSessionCandidates: vi.fn(async () => principal),
      }),
    );

    const response = await flow.handle(
      post('/auth/guest', {}, { cookie: `bd_bootstrap_local=${BOOTSTRAP_TOKEN}` }),
      localBindings(),
    );
    expect(response?.status).toBe(200);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(flow.createPrincipal).toHaveBeenCalledOnce();
  });

  it('Auth成功後のcomplete invalidでもbootstrapを消さず補償可能なpendingへ残す', async () => {
    const claim = vi
      .fn()
      .mockResolvedValueOnce(createClaim)
      .mockResolvedValueOnce({ state: 'invalid' });
    const flow = controller(
      fakeStore({
        claimBootstrapCandidates: claim,
        completeGuestSession: vi.fn(async () => ({ state: 'invalid' } as const)),
      }),
    );

    const response = await flow.handle(
      post('/auth/guest', {}, { cookie: `bd_bootstrap_local=${BOOTSTRAP_TOKEN}` }),
      localBindings(),
    );
    expect(response?.status).toBe(202);
    expect(response?.headers.get('Set-Cookie')).toBeNull();
    expect(flow.createPrincipal).toHaveBeenCalledOnce();
  });

  it('logoutはDB失効後に関連MatchDOの全ACKを待ってcookieを消す', async () => {
    const revoke = vi.fn(async () => ({
      sessionId: SESSION_ID,
      accountId: ACCOUNT_ID,
      sessionVersion: 2,
      alreadyRevoked: false,
    }));
    const success = controller(
      fakeStore({ resolveSessionCandidates: vi.fn(async () => principal), revokeSession: revoke }),
    );
    const loggedOut = await success.handle(
      post('/auth/logout', {}, { cookie: `bd_session_local=${SESSION_TOKEN}` }),
      localBindings(),
    );
    expect(loggedOut?.status).toBe(204);
    expect(setCookieValues(loggedOut!).join('\n')).toContain('Max-Age=0');
    expect(revoke).toHaveBeenCalledOnce();
    expect(success.prepareSessionLogout).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: SESSION_ID,
        accountId: ACCOUNT_ID,
        sessionVersion: 1,
        sessionDigestKeyVersion: 1,
      }),
    );
    expect(success.confirmSessionLogout).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: SESSION_ID,
        accountId: ACCOUNT_ID,
        sessionVersion: 1,
        invalidatedVersion: 2,
      }),
    );
    expect(success.prepareSessionLogout.mock.invocationCallOrder[0]).toBeLessThan(
      revoke.mock.invocationCallOrder[0]!,
    );
    expect(revoke.mock.invocationCallOrder[0]).toBeLessThan(
      success.confirmSessionLogout.mock.invocationCallOrder[0]!,
    );

    const failed = controller(
      fakeStore({
        resolveSessionCandidates: vi.fn(async () => principal),
        revokeSession: vi.fn(async () => {
          throw new Error('database unavailable');
        }),
      }),
    );
    const unavailable = await failed.handle(
      post('/auth/logout', {}, { cookie: `bd_session_local=${SESSION_TOKEN}` }),
      localBindings(),
    );
    expect(unavailable?.status).toBe(503);
    expect(setCookieValues(unavailable!).join('\n')).toContain('Max-Age=0');
    expect(failed.prepareSessionLogout).toHaveBeenCalledOnce();
    expect(failed.confirmSessionLogout).not.toHaveBeenCalled();
  });

  it('DB失効後のMatchDO fan-out未完は503でcookieを消し、coordinator retryへ委ねる', async () => {
    const store = fakeStore({
      resolveSessionCandidates: vi.fn(async () => principal),
      revokeSession: vi.fn(async () => ({
        sessionId: SESSION_ID,
        accountId: ACCOUNT_ID,
        sessionVersion: 2,
        alreadyRevoked: false,
      })),
    });
    const pendingFlow = controller(store, {
      confirmSessionLogout: vi.fn(async () => ({
        state: 'pending' as const,
        invalidatedVersion: 2,
        pendingObjects: 1,
      })),
    });
    const pending = await pendingFlow.handle(
      post('/auth/logout', {}, { cookie: `bd_session_local=${SESSION_TOKEN}` }),
      localBindings(),
    );
    expect(pending?.status).toBe(503);
    expect(pending?.headers.get('Retry-After')).toBe('1');
    expect(setCookieValues(pending!).join('\n')).toContain('Max-Age=0');
    expect(await pending?.json()).toEqual({ error: 'AUTH_UNAVAILABLE' });

    const failedFlow = controller(store, {
      confirmSessionLogout: vi.fn(async () => {
        throw new Error('coordinator unavailable');
      }),
    });
    const failed = await failedFlow.handle(
      post('/auth/logout', {}, { cookie: `bd_session_local=${SESSION_TOKEN}` }),
      localBindings(),
    );
    expect(failed?.status).toBe(503);
    expect(setCookieValues(failed!).join('\n')).toContain('Max-Age=0');
  });

  it('route logoutがDB version更新後に実SessionCoordinator経由で既存socketを閉じる', async () => {
    const matchId = `logout-route-${crypto.randomUUID().slice(0, 8)}`;
    const matchStub: DurableObjectStub<MatchDO> = env.MATCH_DO.get(
      env.MATCH_DO.idFromName(matchId),
    );
    const matchPrincipal = {
      accountId: ACCOUNT_ID,
      sessionId: SESSION_ID,
      sessionVersion: 1,
    };
    await expect(
      matchStub.assignSeat({ ...matchPrincipal, seatId: 'player-1' }),
    ).resolves.toMatchObject({ state: 'assigned', seatId: 'player-1' });
    const issued = await matchStub.issueSeatToken(matchPrincipal);
    expect(issued.state).toBe('issued');
    if (issued.state !== 'issued') throw new Error('Expected issued seat token');
    const upgraded = await matchStub.fetch(
      new Request(`${ORIGIN}/matches/${matchId}/ws`, {
        headers: {
          Upgrade: 'websocket',
          [INTERNAL_ACCOUNT_ID_HEADER]: ACCOUNT_ID,
          [INTERNAL_SESSION_ID_HEADER]: SESSION_ID,
          [INTERNAL_SESSION_VERSION_HEADER]: '1',
        },
      }),
    );
    const socket = upgraded.webSocket;
    expect(upgraded.status).toBe(101);
    if (!socket) throw new Error('Expected WebSocket response');
    socket.accept();
    const authenticated = nextSocketEvent(socket);
    socket.send(JSON.stringify({ type: 'auth', seatToken: issued.seatToken }));
    await expect(authenticated).resolves.toEqual({ kind: 'message', data: 'auth_ok' });

    const revoke = vi.fn(async () => ({
      sessionId: SESSION_ID,
      accountId: ACCOUNT_ID,
      sessionVersion: 2,
      alreadyRevoked: false,
    }));
    const flow = controller(
      fakeStore({
        resolveSessionCandidates: vi.fn(async () => principal),
        revokeSession: revoke,
      }),
      {
        prepareSessionLogout: (bindings, input) =>
          sessionCoordinatorStub(bindings, input.sessionId).prepareLogout(input),
        confirmSessionLogout: (bindings, input) =>
          sessionCoordinatorStub(bindings, input.sessionId).confirmLogout(input),
      },
    );
    const closed = nextSocketEvent(socket);
    const response = await flow.handle(
      post('/auth/logout', {}, { cookie: `bd_session_local=${SESSION_TOKEN}` }),
      {
        ...localBindings(),
        SESSION_COORDINATOR_DO: env.SESSION_COORDINATOR_DO,
      },
    );

    expect(response?.status).toBe(204);
    expect(revoke).toHaveBeenCalledOnce();
    await expect(closed).resolves.toEqual({ kind: 'close', reason: 'SESSION_ENDED' });
    await expect(matchStub.issueSeatToken(matchPrincipal)).resolves.toEqual({
      state: 'not_assigned',
    });
  });

  it('remote guestはcreate_auth claim後にCAPTCHA欠損を安全解放する', async () => {
    const release = vi.fn(async () => true);
    const flow = controller(
      fakeStore({
        claimBootstrapCandidates: vi.fn(async () => createClaim),
        releaseBootstrapClaim: release,
      }),
    );
    const bindings: SessionRuntimeBindings = {
      ...localBindings(),
      APP_ENV: 'production',
      APP_ORIGIN: 'https://play.racc.games',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_AUTH_KEY: 'sb_secret_remote-auth',
      SUPABASE_SECRET_KEY: 'sb_secret_remote-store',
    };
    const request = post('/auth/guest', {}, {
      cookie: `__Host-bd_bootstrap=${BOOTSTRAP_TOKEN}`,
    });
    const remoteRequest = new Request('https://play.racc.games/auth/guest', request);
    remoteRequest.headers.set('Origin', 'https://play.racc.games');

    const response = await flow.handle(remoteRequest, bindings);
    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({ error: 'CAPTCHA_REQUIRED' });
    expect(release).toHaveBeenCalledWith(
      expect.objectContaining({ safeErrorCode: 'CAPTCHA_REQUIRED' }),
    );
    expect(flow.createPrincipal).not.toHaveBeenCalled();

    const existing = controller(
      fakeStore({ resolveSessionCandidates: vi.fn(async () => principal) }),
    );
    const sessionRequest = post('/auth/guest', {}, {
      cookie: `__Host-bd_session=${SESSION_TOKEN}`,
    });
    const remoteSessionRequest = new Request(
      'https://play.racc.games/auth/guest',
      sessionRequest,
    );
    remoteSessionRequest.headers.set('Origin', 'https://play.racc.games');
    const existingResponse = await existing.handle(remoteSessionRequest, bindings);
    expect(existingResponse?.status).toBe(200);
    expect(existing.createPrincipal).not.toHaveBeenCalled();

    const replay = controller(
      fakeStore({
        claimBootstrapCandidates: vi.fn(async () => ({
          state: 'session_ready',
          attemptId: ATTEMPT_ID,
          sessionId: SESSION_ID,
          accountId: ACCOUNT_ID,
          sessionVersion: 1,
          sessionDerivationKeyVersion: 1,
        } as const)),
        resolveSessionCandidates: vi.fn(async () => principal),
      }),
    );
    const replayRequest = post('/auth/guest', {}, {
      cookie: `__Host-bd_bootstrap=${BOOTSTRAP_TOKEN}`,
    });
    const remoteReplayRequest = new Request(
      'https://play.racc.games/auth/guest',
      replayRequest,
    );
    remoteReplayRequest.headers.set('Origin', 'https://play.racc.games');
    const replayResponse = await replay.handle(remoteReplayRequest, bindings);
    expect(replayResponse?.status).toBe(200);
    expect(replay.createPrincipal).not.toHaveBeenCalled();
  });

  it('remote create_authは信頼済みCloudflare IP欠損を安全解放する', async () => {
    const release = vi.fn(async () => true);
    const flow = controller(
      fakeStore({
        claimBootstrapCandidates: vi.fn(async () => createClaim),
        releaseBootstrapClaim: release,
      }),
    );
    const bindings: SessionRuntimeBindings = {
      ...localBindings(),
      APP_ENV: 'production',
      APP_ORIGIN: 'https://play.racc.games',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_AUTH_KEY: 'sb_secret_remote-auth',
      SUPABASE_SECRET_KEY: 'sb_secret_remote-store',
    };
    const request = post('/auth/guest', { captchaToken: 'turnstile-token' }, {
      cookie: `__Host-bd_bootstrap=${BOOTSTRAP_TOKEN}`,
    });
    const remoteRequest = new Request('https://play.racc.games/auth/guest', request);
    remoteRequest.headers.set('Origin', 'https://play.racc.games');

    const response = await flow.handle(remoteRequest, bindings);
    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({ error: 'AUTH_UNAVAILABLE' });
    expect(release).toHaveBeenCalledWith(
      expect.objectContaining({ safeErrorCode: 'CLIENT_IP_INVALID' }),
    );
    expect(flow.createPrincipal).not.toHaveBeenCalled();
  });

  it('method mismatchはauth factoryに触れず405を返す', async () => {
    const flow = controller(fakeStore());
    const response = await flow.handle(
      new Request(`${ORIGIN}/auth/session`, { method: 'POST' }),
      localBindings(),
    );
    expect(response?.status).toBe(405);
    expect(response?.headers.get('Allow')).toBe('GET');
    expect(flow.createStore).not.toHaveBeenCalled();
  });
});
