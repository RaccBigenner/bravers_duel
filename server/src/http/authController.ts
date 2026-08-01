import {
  clearOpaqueCookie,
  parseOpaqueCookie,
  resolveCookieProfile,
  serializeOpaqueCookie,
  type CookieProfile,
} from '../auth/sessionCookies';
import {
  deriveSessionToken,
  encryptAuthGrant,
  generateOpaqueToken,
  tokenDigestCandidates,
  tokenDigestHex,
  type SessionCryptoKeys,
} from '../auth/sessionCrypto';
import { lookupOpaqueSessionToken } from '../auth/sessionAuthentication';
import {
  GuestAuthError,
  createAnonymousPrincipal,
  normalizedTrustedClientIp,
  type AnonymousAuthGrant,
  type AuthServerCredential,
  type CreateAnonymousPrincipalInput,
} from '../auth/supabaseGuestAuth';
import { GuestAdminError, deleteGuestAuthUser } from '../auth/supabaseGuestAdmin';
import {
  SupabaseSessionStore,
  type BootstrapClaim,
  type DigestCandidate,
  type SessionStore,
  type SessionStoreCredential,
} from '../auth/supabaseSessionStore';
import type { SessionPrincipal } from '../auth/supabaseSessionStore';
import {
  SessionRuntimeConfigError,
  createSessionRequestPolicy,
  createSessionRuntimeConfig,
  type SessionRuntimeBindings,
  type SessionRuntimeConfig,
} from '../auth/sessionRuntimeConfig';
import {
  AuthRequestError,
  hasOnlyObjectKeys,
  readAuthJsonObject,
  validateSafeAuthRequest,
  validateUnsafeAuthRequest,
} from './authRequest';

const AUTH_ROUTES = new Map<string, 'GET' | 'POST'>([
  ['/auth/bootstrap', 'POST'],
  ['/auth/guest', 'POST'],
  ['/auth/session', 'GET'],
  ['/auth/logout', 'POST'],
]);

export const AUTH_UPSTREAM_TIMEOUT_MS = 7_000;
export const BOOTSTRAP_CLAIM_LEASE_MS = 30_000;

export interface AuthControllerDependencies {
  createStore(
    credential: SessionStoreCredential,
    signal: AbortSignal,
  ): SessionStore;
  createPrincipal(
    credential: AuthServerCredential,
    input: CreateAnonymousPrincipalInput,
    signal: AbortSignal,
  ): Promise<AnonymousAuthGrant>;
  deletePrincipal(
    credential: SessionStoreCredential,
    accountId: string,
    signal: AbortSignal,
  ): Promise<void>;
  randomUuid(): string;
}

const DEFAULT_DEPENDENCIES = Object.freeze({
  createStore: (credential, signal) =>
    new SupabaseSessionStore(credential, { signal, timeoutMs: AUTH_UPSTREAM_TIMEOUT_MS }),
  createPrincipal: (credential, input, signal) =>
    createAnonymousPrincipal(credential, input, {
      signal,
      timeoutMs: AUTH_UPSTREAM_TIMEOUT_MS,
    }),
  deletePrincipal: (credential, accountId, signal) =>
    deleteGuestAuthUser(credential, accountId, {
      signal,
      timeoutMs: AUTH_UPSTREAM_TIMEOUT_MS,
    }),
  randomUuid: () => crypto.randomUUID(),
} satisfies AuthControllerDependencies);

function responseHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Pragma', 'no-cache');
  headers.set('X-Content-Type-Options', 'nosniff');
  return headers;
}

function authJson(body: unknown, status: number, init?: HeadersInit): Response {
  const headers = responseHeaders(init);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

function authEmpty(status: number, init?: HeadersInit): Response {
  return new Response(null, { status, headers: responseHeaders(init) });
}

function appendClearCookies(headers: Headers, profile: CookieProfile): void {
  headers.append('Set-Cookie', clearOpaqueCookie('session', profile));
  headers.append('Set-Cookie', clearOpaqueCookie('bootstrap', profile));
}

function pending(retryAfterSeconds = 1): Response {
  const retryAfter = Math.max(1, Math.min(30, Math.trunc(retryAfterSeconds)));
  return authJson(
    { state: 'pending' },
    202,
    { 'Retry-After': String(Number.isFinite(retryAfter) ? retryAfter : 1) },
  );
}

function unavailable(): Response {
  return authJson({ error: 'AUTH_UNAVAILABLE' }, 503);
}

function integrityFailure(): Response {
  return authJson({ error: 'SESSION_INTEGRITY_FAILURE' }, 503);
}

function principalBody(principal: SessionPrincipal): Record<string, unknown> {
  return {
    state: 'ready',
    session: {
      sessionId: principal.sessionId,
      accountId: principal.accountId,
      sessionVersion: principal.sessionVersion,
      idleExpiresAt: principal.idleExpiresAt,
      absoluteExpiresAt: principal.absoluteExpiresAt,
    },
  };
}

function readyResponse(
  principal: SessionPrincipal,
  profile: CookieProfile,
  options: { sessionToken?: string; clearBootstrap?: boolean } = {},
): Response {
  const headers = responseHeaders();
  if (options.sessionToken) {
    headers.append('Set-Cookie', serializeOpaqueCookie(options.sessionToken, 'session', profile));
  }
  if (options.clearBootstrap) {
    headers.append('Set-Cookie', clearOpaqueCookie('bootstrap', profile));
  }
  return authJson(principalBody(principal), 200, headers);
}

function sessionRequired(profile: CookieProfile, clear: boolean): Response {
  const headers = responseHeaders();
  if (clear) headers.append('Set-Cookie', clearOpaqueCookie('session', profile));
  return authJson({ error: 'SESSION_REQUIRED' }, 401, headers);
}

function bootstrapRequired(profile: CookieProfile, clear: boolean): Response {
  const headers = responseHeaders();
  if (clear) headers.append('Set-Cookie', clearOpaqueCookie('bootstrap', profile));
  return authJson({ error: 'BOOTSTRAP_REQUIRED' }, 409, headers);
}

async function recoverReadySession(
  claim: Extract<BootstrapClaim, { state: 'session_ready' }>,
  bootstrapToken: string,
  store: SessionStore,
  config: SessionRuntimeConfig,
  profile: CookieProfile,
): Promise<Response> {
  const derivationSecret = config.cryptoKeys.hmacForVersion(
    claim.sessionDerivationKeyVersion,
  );
  if (!derivationSecret) return unavailable();
  const sessionToken = await deriveSessionToken(
    bootstrapToken,
    claim.attemptId,
    derivationSecret,
  );
  const lookup = await lookupOpaqueSessionToken(sessionToken, store, config.cryptoKeys);
  if (lookup.state !== 'ready') return integrityFailure();
  if (
    lookup.principal.sessionId !== claim.sessionId ||
    lookup.principal.accountId !== claim.accountId ||
    lookup.principal.sessionVersion !== claim.sessionVersion ||
    lookup.principal.credentialKeyVersion !== claim.sessionDerivationKeyVersion
  ) {
    return integrityFailure();
  }
  return readyResponse(lookup.principal, profile, {
    sessionToken,
    clearBootstrap: true,
  });
}

async function recoverAfterUncertainCompletion(
  bootstrapCandidates: readonly DigestCandidate[],
  bootstrapToken: string,
  store: SessionStore,
  config: SessionRuntimeConfig,
  profile: CookieProfile,
): Promise<Response> {
  const claim = await store.claimBootstrapCandidates(bootstrapCandidates);
  if (claim.state === 'session_ready') {
    return recoverReadySession(claim, bootstrapToken, store, config, profile);
  }
  if (claim.state === 'ambiguous') return integrityFailure();
  if (
    claim.state === 'pending' ||
    claim.state === 'recover_auth' ||
    claim.state === 'invalid'
  ) {
    // Auth作成後はinvalidでもcommit有無が不明。bootstrapを消さず後続の補償へ残す。
    return pending(1);
  }
  return integrityFailure();
}

function captchaTokenFromBody(
  body: Record<string, unknown>,
  required: boolean,
): string | undefined | null {
  const value = body.captchaToken;
  if (value === undefined) return required ? null : undefined;
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 2048 ||
    value !== value.trim()
  ) {
    return null;
  }
  return value;
}

async function handleBootstrap(
  request: Request,
  config: SessionRuntimeConfig,
  profile: CookieProfile,
  dependencies: AuthControllerDependencies,
): Promise<Response> {
  const cookieHeader = request.headers.get('Cookie');
  const sessionCookie = parseOpaqueCookie(cookieHeader, 'session', profile);
  if (sessionCookie.state !== 'missing') {
    if (sessionCookie.state === 'invalid') return sessionRequired(profile, true);
    const store = dependencies.createStore(config.storeCredential, request.signal);
    const lookup = await lookupOpaqueSessionToken(
      sessionCookie.token,
      store,
      config.cryptoKeys,
    );
    if (lookup.state === 'ready') {
      return readyResponse(lookup.principal, profile, {
        sessionToken: sessionCookie.token,
        clearBootstrap: true,
      });
    }
    if (lookup.state === 'ambiguous' || lookup.state === 'integrity_failure') {
      return integrityFailure();
    }
    return sessionRequired(profile, true);
  }

  const bootstrapCookie = parseOpaqueCookie(cookieHeader, 'bootstrap', profile);
  if (bootstrapCookie.state === 'invalid') return bootstrapRequired(profile, true);
  if (bootstrapCookie.state === 'valid') {
    return authJson({ state: 'bootstrap_ready' }, 200);
  }

  const bootstrapToken = generateOpaqueToken();
  const bootstrapDigestHex = await tokenDigestHex(
    bootstrapToken,
    'bootstrap',
    config.cryptoKeys.activeHmac,
  );
  const store = dependencies.createStore(config.storeCredential, request.signal);
  await store.createBootstrap({
    bootstrapDigestHex,
    digestKeyVersion: config.cryptoKeys.activeHmac.keyVersion,
    sessionDerivationKeyVersion: config.cryptoKeys.activeHmac.keyVersion,
  });
  const headers = responseHeaders();
  headers.append('Set-Cookie', serializeOpaqueCookie(bootstrapToken, 'bootstrap', profile));
  return authJson({ state: 'bootstrap_ready' }, 201, headers);
}

async function handleGuest(
  request: Request,
  body: Record<string, unknown>,
  config: SessionRuntimeConfig,
  profile: CookieProfile,
  dependencies: AuthControllerDependencies,
): Promise<Response> {
  const captchaToken = captchaTokenFromBody(body, false);
  if (captchaToken === null) {
    return authJson({ error: 'AUTH_BODY_INVALID' }, 400);
  }

  const cookieHeader = request.headers.get('Cookie');
  const sessionCookie = parseOpaqueCookie(cookieHeader, 'session', profile);
  if (sessionCookie.state !== 'missing') {
    if (sessionCookie.state === 'invalid') return sessionRequired(profile, true);
    const store = dependencies.createStore(config.storeCredential, request.signal);
    const lookup = await lookupOpaqueSessionToken(
      sessionCookie.token,
      store,
      config.cryptoKeys,
    );
    if (lookup.state === 'ready') {
      return readyResponse(lookup.principal, profile, {
        sessionToken: sessionCookie.token,
        clearBootstrap: true,
      });
    }
    if (lookup.state === 'ambiguous' || lookup.state === 'integrity_failure') {
      return integrityFailure();
    }
    return sessionRequired(profile, true);
  }

  const bootstrapCookie = parseOpaqueCookie(cookieHeader, 'bootstrap', profile);
  if (bootstrapCookie.state !== 'valid') {
    return bootstrapRequired(profile, bootstrapCookie.state === 'invalid');
  }
  const store = dependencies.createStore(config.storeCredential, request.signal);
  const bootstrapCandidates = await tokenDigestCandidates(
    bootstrapCookie.token,
    'bootstrap',
    config.cryptoKeys,
  );
  const claim = await store.claimBootstrapCandidates(bootstrapCandidates);
  if (claim.state === 'invalid') return bootstrapRequired(profile, true);
  if (claim.state === 'ambiguous') return integrityFailure();
  if (claim.state === 'pending') return pending(claim.retryAfterSeconds);
  if (claim.state === 'session_ready') {
    return recoverReadySession(claim, bootstrapCookie.token, store, config, profile);
  }
  if (claim.state === 'recover_auth') {
    try {
      await dependencies.deletePrincipal(
        config.storeCredential,
        claim.accountId,
        request.signal,
      );
    } catch (error) {
      // delete応答喪失もあり得るため、下のDB absence確認だけを正本にする。
      // ただしsecretKey取り違え等の恒久障害も同じ経路に落ちるため、safeなcodeだけ記録して気付けるようにする。
      console.error(
        'guest_auth_recover_delete_failed',
        error instanceof GuestAdminError ? error.code : 'UNKNOWN',
      );
    }
    const reset = await store.resetBootstrapAfterAuthDelete({
      attemptId: claim.attemptId,
      claimId: claim.claimId,
      deletedAccountId: claim.accountId,
    });
    if (reset) {
      return authJson(
        { state: 'retry_required', captchaRequired: config.captchaRequired },
        202,
      );
    }
    return pending(1);
  }

  if (config.captchaRequired && captchaToken === undefined) {
    const released = await store.releaseBootstrapClaim({
      attemptId: claim.attemptId,
      claimId: claim.claimId,
      safeErrorCode: 'CAPTCHA_REQUIRED',
    });
    if (!released) return unavailable();
    return authJson({ error: 'CAPTCHA_REQUIRED' }, 400);
  }
  const trustedClientIp = config.authCredential.forwardClientIp
    ? normalizedTrustedClientIp(request.headers.get('CF-Connecting-IP') ?? undefined)
    : undefined;
  if (config.authCredential.forwardClientIp && !trustedClientIp) {
    const released = await store.releaseBootstrapClaim({
      attemptId: claim.attemptId,
      claimId: claim.claimId,
      safeErrorCode: 'CLIENT_IP_INVALID',
    });
    return released ? unavailable() : integrityFailure();
  }

  const derivationSecret = config.cryptoKeys.hmacForVersion(
    claim.sessionDerivationKeyVersion,
  );
  if (!derivationSecret) return unavailable();

  let grant: AnonymousAuthGrant;
  try {
    grant = await dependencies.createPrincipal(
      config.authCredential,
      {
        guestBootstrap: { attemptId: claim.attemptId, claimId: claim.claimId },
        ...(captchaToken ? { captchaToken } : {}),
        ...(trustedClientIp ? { trustedClientIp } : {}),
      },
      request.signal,
    );
  } catch (error) {
    if (error instanceof GuestAuthError && error.safeToRetry) {
      const released = await store.releaseBootstrapClaim({
        attemptId: claim.attemptId,
        claimId: claim.claimId,
        safeErrorCode: 'AUTH_RATE_LIMITED',
      });
      if (!released) return unavailable();
      return authJson({ error: 'AUTH_RATE_LIMITED' }, 429, { 'Retry-After': '1' });
    }
    if (error instanceof GuestAuthError && error.code === 'AUTH_CONFIG_INVALID') {
      return unavailable();
    }
    return pending(1);
  }

  const sessionId = dependencies.randomUuid();
  let sessionToken: string;
  try {
    sessionToken = await deriveSessionToken(
      bootstrapCookie.token,
      claim.attemptId,
      derivationSecret,
    );
    const encryptedGrant = await encryptAuthGrant(
      grant,
      sessionId,
      1,
      config.cryptoKeys.activeEncryption,
    );
    const sessionDigestHex = await tokenDigestHex(
      sessionToken,
      'session',
      derivationSecret,
    );
    const completed = await store.completeGuestSession({
      attemptId: claim.attemptId,
      claimId: claim.claimId,
      accountId: grant.accountId,
      sessionId,
      sessionDigestHex,
      sessionDigestKeyVersion: derivationSecret.keyVersion,
      encryptedGrant,
      authGrantExpiresAtEpochSeconds: grant.expiresAtEpochSeconds,
    });
    if (completed.state === 'invalid') {
      return recoverAfterUncertainCompletion(
        bootstrapCandidates,
        bootstrapCookie.token,
        store,
        config,
        profile,
      );
    }
    if (
      completed.attemptId !== claim.attemptId ||
      completed.sessionId !== sessionId ||
      completed.accountId !== grant.accountId
    ) {
      return integrityFailure();
    }
    return recoverReadySession(
      {
        state: 'session_ready',
        attemptId: completed.attemptId,
        sessionId: completed.sessionId,
        accountId: completed.accountId,
        sessionVersion: completed.sessionVersion,
        sessionDerivationKeyVersion: claim.sessionDerivationKeyVersion,
      },
      bootstrapCookie.token,
      store,
      config,
      profile,
    );
  } catch {
    return recoverAfterUncertainCompletion(
      bootstrapCandidates,
      bootstrapCookie.token,
      store,
      config,
      profile,
    );
  }
}

async function handleSession(
  request: Request,
  config: SessionRuntimeConfig,
  profile: CookieProfile,
  dependencies: AuthControllerDependencies,
): Promise<Response> {
  const sessionCookie = parseOpaqueCookie(request.headers.get('Cookie'), 'session', profile);
  if (sessionCookie.state !== 'valid') {
    return sessionRequired(profile, sessionCookie.state === 'invalid');
  }
  const store = dependencies.createStore(config.storeCredential, request.signal);
  const lookup = await lookupOpaqueSessionToken(
    sessionCookie.token,
    store,
    config.cryptoKeys,
  );
  if (lookup.state === 'ready') {
    return readyResponse(lookup.principal, profile, { sessionToken: sessionCookie.token });
  }
  if (lookup.state === 'ambiguous' || lookup.state === 'integrity_failure') {
    return integrityFailure();
  }
  return sessionRequired(profile, true);
}

async function handleLogout(
  request: Request,
  config: SessionRuntimeConfig,
  profile: CookieProfile,
  dependencies: AuthControllerDependencies,
): Promise<Response> {
  const sessionCookie = parseOpaqueCookie(request.headers.get('Cookie'), 'session', profile);
  if (sessionCookie.state !== 'valid') {
    const headers = responseHeaders();
    appendClearCookies(headers, profile);
    return authEmpty(204, headers);
  }

  const store = dependencies.createStore(config.storeCredential, request.signal);
  const lookup = await lookupOpaqueSessionToken(
    sessionCookie.token,
    store,
    config.cryptoKeys,
  );
  if (lookup.state === 'ambiguous' || lookup.state === 'integrity_failure') {
    return integrityFailure();
  }
  if (lookup.state === 'ready') {
    const revoked = await store.revokeSession({
      sessionDigestHex: lookup.matchedCandidate.digestHex,
      sessionDigestKeyVersion: lookup.matchedCandidate.keyVersion,
      reason: 'LOGOUT',
    });
    if (
      !revoked ||
      revoked.sessionId !== lookup.principal.sessionId ||
      revoked.accountId !== lookup.principal.accountId ||
      revoked.sessionVersion <= lookup.principal.sessionVersion
    ) {
      return integrityFailure();
    }
  }

  const headers = responseHeaders();
  appendClearCookies(headers, profile);
  return authEmpty(204, headers);
}

export function createAuthRequestHandler(
  dependencies: AuthControllerDependencies = DEFAULT_DEPENDENCIES,
): (
  request: Request,
  bindings: SessionRuntimeBindings,
) => Promise<Response | null> {
  return async (request, bindings) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return null;
    }
    const expectedMethod = AUTH_ROUTES.get(url.pathname);
    if (!expectedMethod) return null;
    if (request.method !== expectedMethod) {
      return authJson(
        { error: 'METHOD_NOT_ALLOWED' },
        405,
        { Allow: expectedMethod },
      );
    }

    try {
      const policy = createSessionRequestPolicy(bindings);
      if (expectedMethod === 'POST') validateUnsafeAuthRequest(request, policy.appOrigin);
      else validateSafeAuthRequest(request, policy.appOrigin);

      let body: Record<string, unknown> = {};
      if (expectedMethod === 'POST') {
        body = await readAuthJsonObject(request);
        const allowedKeys = url.pathname === '/auth/guest' ? ['captchaToken'] : [];
        if (!hasOnlyObjectKeys(body, allowedKeys)) {
          throw new AuthRequestError('AUTH_BODY_INVALID', 400);
        }
      }

      const config = createSessionRuntimeConfig(bindings);
      const profile = resolveCookieProfile(config.appEnvironment, request.url);
      if (url.pathname === '/auth/bootstrap') {
        return await handleBootstrap(request, config, profile, dependencies);
      }
      if (url.pathname === '/auth/guest') {
        return await handleGuest(request, body, config, profile, dependencies);
      }
      if (url.pathname === '/auth/session') {
        return await handleSession(request, config, profile, dependencies);
      }
      return await handleLogout(request, config, profile, dependencies);
    } catch (error) {
      if (error instanceof AuthRequestError) {
        return authJson({ error: error.code }, error.status);
      }
      if (error instanceof SessionRuntimeConfigError) return unavailable();
      return unavailable();
    }
  };
}

export const handleAuthRequest = createAuthRequestHandler();
