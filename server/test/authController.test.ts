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
  const dependencies: AuthControllerDependencies = {
    createStore,
    createPrincipal,
    deletePrincipal,
    randomUuid: () => SESSION_ID,
    ...overrides,
  };
  return {
    handle: createAuthRequestHandler(dependencies),
    createStore,
    createPrincipal,
    deletePrincipal,
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

  it('logoutはDB失効成功後だけcookieを消し、失敗時はcookieを維持する', async () => {
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
    expect(unavailable?.headers.get('Set-Cookie')).toBeNull();
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
