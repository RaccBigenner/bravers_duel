import { describe, expect, it, vi } from 'vitest';
import {
  GuestAuthError,
  createAnonymousPrincipal,
  type AuthServerCredential,
} from '../src/auth/supabaseGuestAuth';

const ACCOUNT_ID = '11111111-2222-4333-8444-555555555555';
const ACCESS_TOKEN = 'access-token-sentinel';
const REFRESH_TOKEN = 'refresh-token-sentinel';
const EXPIRES_AT = 4_102_444_800;
const ATTEMPT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CLAIM_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

const localCredential: AuthServerCredential = {
  environment: 'local',
  supabaseUrl: 'http://127.0.0.1:54321',
  apiKey: 'sb_publishable_local-test',
  keyMode: 'publishable',
  forwardClientIp: false,
};

function guestInput(extra: { captchaToken?: string; trustedClientIp?: string } = {}) {
  return {
    guestBootstrap: { attemptId: ATTEMPT_ID, claimId: CLAIM_ID },
    ...extra,
  };
}

function successBody(overrides: Record<string, unknown> = {}) {
  const user = {
    id: ACCOUNT_ID,
    aud: 'authenticated',
    role: 'authenticated',
    is_anonymous: true,
    created_at: '2026-08-01T00:00:00Z',
  };
  return {
    access_token: ACCESS_TOKEN,
    refresh_token: REFRESH_TOKEN,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: EXPIRES_AT,
    user,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OLG-111 Supabase anonymous principal provider', () => {
  it('request-scoped clientで匿名grantを作り、claim metadataとcaptchaだけをAuthへ渡す', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(successBody()));

    const grant = await createAnonymousPrincipal(
      localCredential,
      guestInput({ captchaToken: 'turnstile-token' }),
      { fetch: fetchMock },
    );

    expect(grant).toEqual({
      accountId: ACCOUNT_ID,
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      expiresAtEpochSeconds: EXPIRES_AT,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestUrl).toBe('http://127.0.0.1:54321/auth/v1/signup');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      data: {
        guest_bootstrap_attempt_id: ATTEMPT_ID,
        guest_bootstrap_claim_id: CLAIM_ID,
      },
      gotrue_meta_security: { captcha_token: 'turnstile-token' },
    });
  });

  it.each([
    ['metadata欠損', {}],
    [
      '非canonical attempt ID',
      {
        guestBootstrap: {
          attemptId: ATTEMPT_ID.toUpperCase(),
          claimId: CLAIM_ID,
        },
      },
    ],
    [
      '不正なclaim ID',
      {
        guestBootstrap: {
          attemptId: ATTEMPT_ID,
          claimId: 'not-a-claim',
        },
      },
    ],
  ])('%sではAuth requestを始めない', async (_label, input) => {
    const fetchMock = vi.fn(async () => jsonResponse(successBody()));
    await expect(
      createAnonymousPrincipal(localCredential, input as never, { fetch: fetchMock }),
    ).rejects.toMatchObject({ code: 'AUTH_CONFIG_INVALID', safeToRetry: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('production IP forwardingはsb_secretと信頼済み単一IPの組だけ許可する', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(successBody()));
    const credential: AuthServerCredential = {
      environment: 'remote',
      supabaseUrl: 'https://project.supabase.co',
      apiKey: 'sb_secret_server-only',
      keyMode: 'secret',
      forwardClientIp: true,
    };

    await createAnonymousPrincipal(
      credential,
      guestInput({ trustedClientIp: '203.0.113.8' }),
      { fetch: fetchMock },
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('Sb-Forwarded-For')).toBe('203.0.113.8');

    await expect(
      createAnonymousPrincipal(
        {
          ...credential,
          environment: 'local',
          keyMode: 'publishable',
          forwardClientIp: false,
        },
        guestInput({ trustedClientIp: '203.0.113.8' }),
        { fetch: fetchMock },
      ),
    ).rejects.toMatchObject({ code: 'AUTH_CONFIG_INVALID' });
    await createAnonymousPrincipal(
      credential,
      guestInput({ trustedClientIp: '2001:db8::8' }),
      { fetch: fetchMock },
    );
    const [, ipv6Init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(new Headers(ipv6Init.headers).get('Sb-Forwarded-For')).toBe('2001:db8::8');
    await expect(
      createAnonymousPrincipal(
        credential,
        guestInput({ trustedClientIp: '1:::2' }),
        { fetch: fetchMock },
      ),
    ).rejects.toMatchObject({ code: 'AUTH_CONFIG_INVALID' });
    await expect(
      createAnonymousPrincipal(
        credential,
        guestInput({ trustedClientIp: '203.000.113.8' }),
        { fetch: fetchMock },
      ),
    ).rejects.toMatchObject({ code: 'AUTH_CONFIG_INVALID' });
    await expect(
      createAnonymousPrincipal(
        credential,
        guestInput({ trustedClientIp: '203.0.113.8, 198.51.100.4' }),
        { fetch: fetchMock },
      ),
    ).rejects.toMatchObject({ code: 'AUTH_CONFIG_INVALID' });
    await expect(
      createAnonymousPrincipal(
        {
          ...localCredential,
          environment: 'remote',
          keyMode: 'secret',
          apiKey: 'sb_secret_server-only',
          forwardClientIp: true,
          supabaseUrl: 'http://127.0.0.1:54321',
        },
        guestInput({ trustedClientIp: '203.0.113.8' }),
        { fetch: fetchMock },
      ),
    ).rejects.toMatchObject({ code: 'AUTH_CONFIG_INVALID' });
    await expect(
      createAnonymousPrincipal(
        {
          ...credential,
          supabaseUrl: 'https://127.0.0.2',
        },
        guestInput({ trustedClientIp: '203.0.113.8' }),
        { fetch: fetchMock },
      ),
    ).rejects.toMatchObject({ code: 'AUTH_CONFIG_INVALID' });
    await expect(
      createAnonymousPrincipal(
        { ...localCredential, apiKey: 42 as unknown as string },
        guestInput(),
        { fetch: fetchMock },
      ),
    ).rejects.toMatchObject({ code: 'AUTH_CONFIG_INVALID' });
  });

  it('Auth拒否を安定codeへ写し、raw messageやtokenを例外へ含めない', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          error_code: 'over_request_rate_limit',
          msg: `raw ${ACCESS_TOKEN} ${REFRESH_TOKEN}`,
        },
        429,
      ),
    );

    let failure: unknown;
    try {
      await createAnonymousPrincipal(localCredential, guestInput(), { fetch: fetchMock });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(GuestAuthError);
    expect(failure).toMatchObject({
      code: 'ANONYMOUS_SIGN_IN_REJECTED',
      safeToRetry: true,
      upstreamStatus: 429,
      upstreamCode: 'over_request_rate_limit',
    });
    expect(String(failure)).not.toContain(ACCESS_TOKEN);
    expect(String(failure)).not.toContain(REFRESH_TOKEN);
  });

  it.each([
    ['user欠損', { user: null }],
    ['非匿名user', { user: { ...successBody().user, is_anonymous: false } }],
    [
      '不正なUUID',
      {
        user: {
          ...successBody().user,
          id: 'not-a-uuid',
        },
      },
    ],
    ['access token欠損', { access_token: '' }],
    ['refresh token欠損', { refresh_token: '' }],
    ['期限切れtoken', { expires_at: 1 }],
  ])('%sをupstream成功として受理しない', async (_label, overrides) => {
    const fetchMock = vi.fn(async () => jsonResponse(successBody(overrides)));

    await expect(
      createAnonymousPrincipal(localCredential, guestInput(), { fetch: fetchMock }),
    ).rejects.toMatchObject({ code: 'AUTH_RESPONSE_INVALID' });
  });

  it('network失敗を内部で再試行せず、曖昧成功から2人目を作らない', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('connection reset after upstream commit');
    });

    await expect(
      createAnonymousPrincipal(localCredential, guestInput(), { fetch: fetchMock }),
    ).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE', safeToRetry: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('応答しないAuth requestを期限内に中断し、再試行しない', async () => {
    let aborted = false;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(init.signal?.reason);
            },
            { once: true },
          );
        }),
    );

    await expect(
      createAnonymousPrincipal(localCredential, guestInput(), { fetch: fetchMock, timeoutMs: 5 }),
    ).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE', safeToRetry: false });
    expect(aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('AbortSignalを無視するcustom fetchもproviderの期限で打ち切る', async () => {
    const fetchMock = vi.fn(async () => new Promise<Response>(() => {}));
    const startedAt = Date.now();

    await expect(
      createAnonymousPrincipal(localCredential, guestInput(), { fetch: fetchMock, timeoutMs: 5 }),
    ).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE', safeToRetry: false });
    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('headers後に止まったresponse bodyも同じ期限で中断する', async () => {
    const response = jsonResponse(successBody());
    vi.spyOn(response, 'json').mockImplementation(async () => new Promise(() => {}));
    const fetchMock = vi.fn(async () => response);
    const startedAt = Date.now();

    await expect(
      createAnonymousPrincipal(localCredential, guestInput(), { fetch: fetchMock, timeoutMs: 5 }),
    ).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE', safeToRetry: false });
    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('既にabort済みならcustom fetchを一度も呼ばない', async () => {
    const controller = new AbortController();
    controller.abort(new Error(`raw ${ACCESS_TOKEN}`));
    const fetchMock = vi.fn(async () => jsonResponse(successBody()));

    await expect(
      createAnonymousPrincipal(localCredential, guestInput(), { fetch: fetchMock, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE', safeToRetry: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('5xxは作成済みか判別できないため再試行可能にしない', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error_code: 'unexpected_failure', msg: 'upstream failure' }, 503),
    );

    await expect(
      createAnonymousPrincipal(localCredential, guestInput(), { fetch: fetchMock }),
    ).rejects.toMatchObject({
      code: 'AUTH_UNAVAILABLE',
      safeToRetry: false,
      upstreamStatus: 503,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
