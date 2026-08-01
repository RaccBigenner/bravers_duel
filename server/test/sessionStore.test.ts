import { describe, expect, it, vi } from 'vitest';
import {
  SessionStoreError,
  SupabaseSessionStore,
  type SessionStoreCredential,
} from '../src/auth/supabaseSessionStore';

const ATTEMPT_ID = '11111111-2222-4333-8444-555555555555';
const CLAIM_ID = '22222222-3333-4444-8555-666666666666';
const ACCOUNT_ID = '33333333-4444-4555-8666-777777777777';
const SESSION_ID = '44444444-5555-4666-8777-888888888888';
const SECRET = 'sb_secret_server-only-sentinel';
const credential: SessionStoreCredential = {
  environment: 'local',
  supabaseUrl: 'http://127.0.0.1:54321',
  secretKey: SECRET,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OLG-113 Supabase session store', () => {
  it('secret keyの限定RPCでbootstrapを作りraw tokenを送らない', async () => {
    const fetchMock = vi.fn(async () => json({ state: 'created', attempt_id: ATTEMPT_ID }));
    const store = new SupabaseSessionStore(credential, { fetch: fetchMock });

    await expect(
      store.createBootstrap({
        bootstrapDigestHex: '11'.repeat(32),
        digestKeyVersion: 2,
        sessionDerivationKeyVersion: 3,
      }),
    ).resolves.toEqual({ attemptId: ATTEMPT_ID });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:54321/rest/v1/rpc/create_guest_bootstrap_attempt');
    expect(new Headers(init.headers).get('apikey')).toBe(SECRET);
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(String(init.body))).toEqual({
      p_bootstrap_digest_hex: '11'.repeat(32),
      p_digest_key_version: 2,
      p_session_derivation_key_version: 3,
    });
  });

  it.each([
    [{ state: 'invalid' }, { state: 'invalid' }],
    [{ state: 'ambiguous' }, { state: 'ambiguous' }],
    [{ state: 'pending', retry_after_seconds: 1 }, { state: 'pending', retryAfterSeconds: 1 }],
    [
      {
        state: 'create_auth',
        attempt_id: ATTEMPT_ID,
        claim_id: CLAIM_ID,
        session_derivation_key_version: 3,
      },
      {
        state: 'create_auth',
        attemptId: ATTEMPT_ID,
        claimId: CLAIM_ID,
        sessionDerivationKeyVersion: 3,
      },
    ],
    [
      {
        state: 'recover_auth',
        attempt_id: ATTEMPT_ID,
        claim_id: CLAIM_ID,
        account_id: ACCOUNT_ID,
      },
      {
        state: 'recover_auth',
        attemptId: ATTEMPT_ID,
        claimId: CLAIM_ID,
        accountId: ACCOUNT_ID,
      },
    ],
  ])('claim result %jをstrict unionへ写す', async (response, expected) => {
    const store = new SupabaseSessionStore(credential, {
      fetch: async () => json(response),
    });

    await expect(
      store.claimBootstrap({ bootstrapDigestHex: '22'.repeat(32), digestKeyVersion: 1 }),
    ).resolves.toEqual(expected);
  });

  it('bootstrap候補を1 RPCへ渡し、重複や9鍵目をI/O前に拒否する', async () => {
    const fetchMock = vi.fn(async () => json({ state: 'ambiguous' }));
    const store = new SupabaseSessionStore(credential, { fetch: fetchMock });
    const candidates = [
      { digestHex: '21'.repeat(32), keyVersion: 2 },
      { digestHex: '22'.repeat(32), keyVersion: 1 },
    ];

    await expect(store.claimBootstrapCandidates(candidates)).resolves.toEqual({
      state: 'ambiguous',
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'http://127.0.0.1:54321/rest/v1/rpc/claim_guest_bootstrap_attempt_candidates',
    );
    expect(JSON.parse(String(init.body))).toEqual({
      p_candidates: [
        { digest_hex: '21'.repeat(32), digest_key_version: 2 },
        { digest_hex: '22'.repeat(32), digest_key_version: 1 },
      ],
    });

    fetchMock.mockClear();
    await expect(
      store.claimBootstrapCandidates([candidates[0]!, candidates[0]!]),
    ).rejects.toMatchObject({ code: 'SESSION_STORE_CONFIG_INVALID' });
    await expect(
      store.claimBootstrapCandidates(
        Array.from({ length: 9 }, (_, index) => ({
          digestHex: (index + 1).toString(16).padStart(2, '0').repeat(32),
          keyVersion: index + 1,
        })),
      ),
    ).rejects.toMatchObject({ code: 'SESSION_STORE_CONFIG_INVALID' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('session完成RPCへ暗号文/digestだけを渡し成功応答を検証する', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        state: 'session_ready',
        attempt_id: ATTEMPT_ID,
        session_id: SESSION_ID,
        account_id: ACCOUNT_ID,
        session_version: 1,
        idle_expires_at: '2026-10-30T00:00:00Z',
        absolute_expires_at: '2027-08-01T00:00:00Z',
      }),
    );
    const store = new SupabaseSessionStore(credential, { fetch: fetchMock });
    const encryptedGrant = {
      schemaVersion: 1 as const,
      keyVersion: 4,
      grantRevision: 1,
      ciphertextHex: 'aa'.repeat(17),
      nonceHex: 'bb'.repeat(12),
    };

    await expect(
      store.completeGuestSession({
        attemptId: ATTEMPT_ID,
        claimId: CLAIM_ID,
        accountId: ACCOUNT_ID,
        sessionId: SESSION_ID,
        sessionDigestHex: '33'.repeat(32),
        sessionDigestKeyVersion: 2,
        encryptedGrant,
        authGrantExpiresAtEpochSeconds: 1_800_000_000,
      }),
    ).resolves.toMatchObject({ state: 'session_ready', sessionId: SESSION_ID });
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));
    expect(body).toMatchObject({
      p_attempt_id: ATTEMPT_ID,
      p_claim_id: CLAIM_ID,
      p_account_id: ACCOUNT_ID,
      p_session_id: SESSION_ID,
      p_token_digest_hex: '33'.repeat(32),
      p_auth_grant_ciphertext_hex: encryptedGrant.ciphertextHex,
      p_auth_grant_nonce_hex: encryptedGrant.nonceHex,
    });
    expect(JSON.stringify(body)).not.toContain('access-token');
    expect(JSON.stringify(body)).not.toContain('refresh-token');
  });

  it('resolve/version/revokeのnull・boolean・principalをstrictに扱う', async () => {
    const responses = [
      json({
        session_id: SESSION_ID,
        account_id: ACCOUNT_ID,
        session_version: 1,
        credential_state: 'CURRENT',
        credential_key_version: 1,
        idle_expires_at: '2026-10-30T00:00:00Z',
        absolute_expires_at: '2027-08-01T00:00:00Z',
      }),
      json(true),
      json({
        session_id: SESSION_ID,
        account_id: ACCOUNT_ID,
        session_version: 2,
        already_revoked: false,
      }),
      json(null),
    ];
    const store = new SupabaseSessionStore(credential, {
      fetch: async () => responses.shift() ?? json(null),
    });

    await expect(
      store.resolveSession({ sessionDigestHex: '44'.repeat(32), sessionDigestKeyVersion: 1 }),
    ).resolves.toMatchObject({ accountId: ACCOUNT_ID, credentialState: 'CURRENT' });
    await expect(
      store.validateSessionVersion({ sessionId: SESSION_ID, sessionVersion: 1 }),
    ).resolves.toBe(true);
    await expect(
      store.revokeSession({
        sessionDigestHex: '44'.repeat(32),
        sessionDigestKeyVersion: 1,
        reason: 'LOGOUT',
      }),
    ).resolves.toMatchObject({ sessionVersion: 2, alreadyRevoked: false });
    await expect(
      store.resolveSession({ sessionDigestHex: '44'.repeat(32), sessionDigestKeyVersion: 1 }),
    ).resolves.toBeNull();
  });

  it('session候補も1 RPCで解決し、multi-hitをprincipalとして採用しない', async () => {
    const responses = [
      json({ state: 'ambiguous' }),
      json({
        session_id: SESSION_ID,
        account_id: ACCOUNT_ID,
        session_version: 3,
        credential_state: 'CURRENT',
        credential_key_version: 2,
        idle_expires_at: '2026-10-30T00:00:00Z',
        absolute_expires_at: '2027-08-01T00:00:00Z',
      }),
    ];
    const fetchMock = vi.fn(async () => responses.shift()!);
    const store = new SupabaseSessionStore(credential, { fetch: fetchMock });
    const candidates = [
      { digestHex: '51'.repeat(32), keyVersion: 2 },
      { digestHex: '52'.repeat(32), keyVersion: 1 },
    ];

    await expect(store.resolveSessionCandidates(candidates)).resolves.toEqual({
      state: 'ambiguous',
    });
    await expect(store.resolveSessionCandidates(candidates)).resolves.toMatchObject({
      sessionId: SESSION_ID,
      credentialKeyVersion: 2,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'http://127.0.0.1:54321/rest/v1/rpc/resolve_app_session_candidates',
    );
    expect(JSON.parse(String(init.body))).toEqual({
      p_candidates: [
        { digest_hex: '51'.repeat(32), digest_key_version: 2 },
        { digest_hex: '52'.repeat(32), digest_key_version: 1 },
      ],
    });
  });

  it('remote/local URLとserver secretをfail closedで検証する', () => {
    expect(
      () =>
        new SupabaseSessionStore({
          environment: 'remote',
          supabaseUrl: 'http://127.0.0.1:54321',
          secretKey: SECRET,
        }),
    ).toThrowError(SessionStoreError);
    expect(
      () =>
        new SupabaseSessionStore({
          environment: 'remote',
          supabaseUrl: 'https://127.0.0.2',
          secretKey: SECRET,
        }),
    ).toThrowError(SessionStoreError);
    expect(
      () =>
        new SupabaseSessionStore({
          environment: 'remote',
          supabaseUrl: 'https://project.supabase.co',
          secretKey: 'sb_publishable_not-secret',
        }),
    ).toThrowError(SessionStoreError);
    expect(
      () =>
        new SupabaseSessionStore({
          environment: 'typo' as 'local',
          supabaseUrl: 'http://evil.example',
          secretKey: SECRET,
        }),
    ).toThrowError(SessionStoreError);
  });

  it('upstream error/bodyに含まれるsecretやraw messageを例外へ出さない', async () => {
    const store = new SupabaseSessionStore(credential, {
      fetch: async () => json({ message: `raw ${SECRET}` }, 500),
    });
    let failure: unknown;
    try {
      await store.resolveSession({
        sessionDigestHex: '55'.repeat(32),
        sessionDigestKeyVersion: 1,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'SESSION_STORE_UNAVAILABLE' });
    expect(String(failure)).not.toContain(SECRET);
  });

  it('壊れたsuccess JSONを受理しない', async () => {
    const store = new SupabaseSessionStore(credential, {
      fetch: async () => json({ state: 'created', attempt_id: 'NOT-A-UUID' }),
    });
    await expect(
      store.createBootstrap({
        bootstrapDigestHex: '66'.repeat(32),
        digestKeyVersion: 1,
        sessionDerivationKeyVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_STORE_RESPONSE_INVALID' });
  });
});
