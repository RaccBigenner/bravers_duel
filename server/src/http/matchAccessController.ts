import {
  clearOpaqueCookie,
  parseOpaqueCookie,
  resolveCookieProfile,
  type CookieProfile,
} from '../auth/sessionCookies';
import { lookupOpaqueSessionToken } from '../auth/sessionAuthentication';
import {
  createSessionRequestPolicy,
  createSessionRuntimeConfig,
  SessionRuntimeConfigError,
  type SessionRuntimeBindings,
  type SessionRuntimeConfig,
} from '../auth/sessionRuntimeConfig';
import {
  SupabaseSessionStore,
  type SessionPrincipal,
  type SessionStore,
  type SessionStoreCredential,
} from '../auth/supabaseSessionStore';
import {
  INTERNAL_ACCOUNT_ID_HEADER,
  INTERNAL_SESSION_ID_HEADER,
  INTERNAL_SESSION_VERSION_HEADER,
  type MatchSessionPrincipal,
  type SeatTokenIssueResult,
} from '../match/matchDurableObject';
import {
  AuthRequestError,
  hasOnlyObjectKeys,
  readAuthJsonObject,
  validateUnsafeAuthRequest,
  validateWebSocketAuthRequest,
} from './authRequest';

const SEAT_TOKEN_PATH = /^\/matches\/([A-Za-z0-9_-]{1,64})\/seat-token$/;
const WEB_SOCKET_PATH = /^\/matches\/([A-Za-z0-9_-]{1,64})\/ws$/;
const LOCAL_SMOKE_MATCH_ID = 'local-smoke';

/** OLG-121のserver-owned assignment directoryが入るまでpublic正方向を開けない。 */
export const MATCH_SEAT_PUBLIC_PORT_ENABLED = false;

interface MatchStub {
  issueSeatToken(principal: MatchSessionPrincipal): Promise<SeatTokenIssueResult>;
  fetch(request: Request): Promise<Response>;
}

interface MatchNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): MatchStub;
}

export interface MatchAccessBindings extends SessionRuntimeBindings {
  MATCH_DO?: MatchNamespace;
}

export interface MatchAccessDependencies {
  publicPortEnabled: boolean;
  createStore(
    credential: SessionStoreCredential,
    signal: AbortSignal,
  ): SessionStore;
  matchStub(bindings: MatchAccessBindings, matchId: string): MatchStub;
}

const DEFAULT_DEPENDENCIES = Object.freeze({
  publicPortEnabled: MATCH_SEAT_PUBLIC_PORT_ENABLED,
  createStore: (credential, signal) =>
    new SupabaseSessionStore(credential, { signal, timeoutMs: 7_000 }),
  matchStub: (bindings, matchId) => {
    if (!bindings.MATCH_DO) throw new Error('MATCH_NAMESPACE_UNAVAILABLE');
    return bindings.MATCH_DO.get(bindings.MATCH_DO.idFromName(matchId));
  },
} satisfies MatchAccessDependencies);

function responseHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Pragma', 'no-cache');
  headers.set('X-Content-Type-Options', 'nosniff');
  return headers;
}

function matchJson(body: unknown, status: number, init?: HeadersInit): Response {
  const headers = responseHeaders(init);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

function sessionRequired(profile?: CookieProfile, clear = false): Response {
  const headers = responseHeaders();
  if (profile && clear) {
    headers.append('Set-Cookie', clearOpaqueCookie('session', profile));
  }
  return matchJson({ error: 'SESSION_REQUIRED' }, 401, headers);
}

function matchUnavailable(): Response {
  return matchJson({ error: 'MATCH_NOT_AVAILABLE' }, 404);
}

function unavailable(): Response {
  return matchJson({ error: 'MATCH_ACCESS_UNAVAILABLE' }, 503);
}

function integrityFailure(): Response {
  return matchJson({ error: 'SESSION_INTEGRITY_FAILURE' }, 503);
}

function localSmokeRequest(
  request: Request,
  appEnvironment: string,
  appOrigin: string,
  matchId: string,
): boolean {
  if (
    appEnvironment !== 'local' ||
    matchId !== LOCAL_SMOKE_MATCH_ID ||
    request.method !== 'GET'
  ) {
    return false;
  }
  const url = new URL(request.url);
  return url.origin === appOrigin && url.search === '';
}

async function resolvePrincipal(
  request: Request,
  config: SessionRuntimeConfig,
  profile: CookieProfile,
  dependencies: MatchAccessDependencies,
): Promise<{ principal: SessionPrincipal } | { response: Response }> {
  const cookie = parseOpaqueCookie(request.headers.get('Cookie'), 'session', profile);
  if (cookie.state !== 'valid') {
    return { response: sessionRequired(profile, cookie.state === 'invalid') };
  }
  const store = dependencies.createStore(config.storeCredential, request.signal);
  const lookup = await lookupOpaqueSessionToken(cookie.token, store, config.cryptoKeys);
  if (lookup.state === 'ready') return { principal: lookup.principal };
  if (lookup.state === 'ambiguous' || lookup.state === 'integrity_failure') {
    return { response: integrityFailure() };
  }
  return { response: sessionRequired(profile, true) };
}

function internalWebSocketRequest(
  request: Request,
  principal: SessionPrincipal,
): Request {
  const headers = new Headers({ Upgrade: 'websocket' });
  headers.set(INTERNAL_ACCOUNT_ID_HEADER, principal.accountId);
  headers.set(INTERNAL_SESSION_ID_HEADER, principal.sessionId);
  headers.set(INTERNAL_SESSION_VERSION_HEADER, String(principal.sessionVersion));
  // Cookie/Origin/client指定のinternal headerをDOへ転送しない。
  return new Request(request.url, { method: 'GET', headers });
}

function route(pathname: string):
  | { kind: 'seat-token'; matchId: string; method: 'POST' }
  | { kind: 'websocket'; matchId: string; method: 'GET' }
  | null {
  const seatToken = pathname.match(SEAT_TOKEN_PATH)?.[1];
  if (seatToken) return { kind: 'seat-token', matchId: seatToken, method: 'POST' };
  const webSocket = pathname.match(WEB_SOCKET_PATH)?.[1];
  if (webSocket) return { kind: 'websocket', matchId: webSocket, method: 'GET' };
  return null;
}

export function createMatchAccessRequestHandler(
  dependencies: MatchAccessDependencies = DEFAULT_DEPENDENCIES,
): (
  request: Request,
  bindings: MatchAccessBindings,
) => Promise<Response | null> {
  return async (request, bindings) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return null;
    }
    const matched = route(url.pathname);
    if (!matched) return null;
    if (request.method !== matched.method) {
      return matchJson(
        { error: 'METHOD_NOT_ALLOWED' },
        405,
        { Allow: matched.method },
      );
    }

    try {
      const policy = createSessionRequestPolicy(bindings);
      if (
        matched.kind === 'websocket' &&
        localSmokeRequest(
          request,
          policy.appEnvironment,
          policy.appOrigin,
          matched.matchId,
        )
      ) {
        return await dependencies.matchStub(bindings, matched.matchId).fetch(request);
      }

      if (matched.kind === 'seat-token') {
        validateUnsafeAuthRequest(request, policy.appOrigin);
        const body = await readAuthJsonObject(request);
        if (!hasOnlyObjectKeys(body, [])) {
          throw new AuthRequestError('AUTH_BODY_INVALID', 400);
        }
      } else {
        validateWebSocketAuthRequest(request, policy.appOrigin);
      }

      // OLG-121前はここで止め、認証済みclientにも任意名のDOを作らせない。
      if (!dependencies.publicPortEnabled) return matchUnavailable();

      const config = createSessionRuntimeConfig(bindings);
      const profile = resolveCookieProfile(config.appEnvironment, request.url);
      const resolution = await resolvePrincipal(request, config, profile, dependencies);
      if ('response' in resolution) return resolution.response;
      const stub = dependencies.matchStub(bindings, matched.matchId);

      if (matched.kind === 'websocket') {
        return await stub.fetch(internalWebSocketRequest(request, resolution.principal));
      }

      const issued = await stub.issueSeatToken(resolution.principal);
      if (issued.state === 'not_assigned') return matchUnavailable();
      if (issued.state === 'rate_limited') {
        return matchJson(
          { error: 'MATCH_ACCESS_RATE_LIMITED' },
          429,
          { 'Retry-After': '1' },
        );
      }
      return matchJson(
        {
          seatToken: issued.seatToken,
          expiresAt: new Date(issued.expiresAtEpochMs).toISOString(),
        },
        201,
      );
    } catch (error) {
      if (error instanceof AuthRequestError) {
        return matchJson({ error: error.code }, error.status);
      }
      if (error instanceof SessionRuntimeConfigError) return unavailable();
      return unavailable();
    }
  };
}

export const handleMatchAccessRequest = createMatchAccessRequestHandler();
