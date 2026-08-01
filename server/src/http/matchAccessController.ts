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
import { isOpaqueToken } from '../auth/sessionCrypto';
import {
  INTERNAL_ACCOUNT_ID_HEADER,
  INTERNAL_SESSION_ID_HEADER,
  INTERNAL_SESSION_VERSION_HEADER,
  SEAT_TOKEN_TTL_MS,
  type MatchSessionPrincipal,
  type SeatTokenIssueResult,
} from '../match/matchDurableObject';
import {
  sessionCoordinatorStub,
  type SessionCoordinatorBindings,
  type SessionCoordinatorPort,
} from '../session/sessionCoordinatorDurableObject';
import {
  AuthRequestError,
  hasOnlyObjectKeys,
  readAuthJsonObject,
  validateUnsafeAuthRequest,
  validateWebSocketAuthRequest,
} from './authRequest';

const SEAT_TOKEN_PATH = /^\/matches\/([A-Za-z0-9_-]{1,64})\/seat-token$/;
const WEB_SOCKET_PATH = /^\/matches\/([A-Za-z0-9_-]{1,64})\/ws$/;
const NPC_MATCH_START_PATH = '/matches/npc';
const LOCAL_SMOKE_MATCH_ID = 'local-smoke';
const NPC_MATCH_ID_PATTERN =
  /^npc-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** server-owned予約とmembership preflightを必ず通すpublic match port。 */
export const MATCH_SEAT_PUBLIC_PORT_ENABLED = true;

type NpcBattleStartResult =
  | { state: 'ready'; created: boolean }
  | { state: 'conflict' }
  | { state: 'unavailable' };

interface MatchStub {
  issueSeatToken(principal: MatchSessionPrincipal): Promise<SeatTokenIssueResult>;
  startNpcBattle(input: {
    principal: MatchSessionPrincipal;
    seed: number;
  }): Promise<NpcBattleStartResult>;
  fetch(request: Request): Promise<Response>;
}

interface MatchNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): MatchStub;
}

export interface MatchAccessBindings
  extends SessionRuntimeBindings, SessionCoordinatorBindings {
  MATCH_DO?: MatchNamespace;
}

export interface MatchAccessDependencies {
  publicPortEnabled: boolean;
  createStore(
    credential: SessionStoreCredential,
    signal: AbortSignal,
  ): SessionStore;
  coordinatorStub(
    bindings: MatchAccessBindings,
    sessionId: string,
  ): SessionCoordinatorPort;
  matchStub(bindings: MatchAccessBindings, matchId: string): MatchStub;
}

const DEFAULT_DEPENDENCIES = Object.freeze({
  publicPortEnabled: MATCH_SEAT_PUBLIC_PORT_ENABLED,
  createStore: (credential, signal) =>
    new SupabaseSessionStore(credential, { signal, timeoutMs: 7_000 }),
  coordinatorStub: (bindings, sessionId) => sessionCoordinatorStub(bindings, sessionId),
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

function matchStateUnavailable(): Response {
  return matchJson({ error: 'MATCH_STATE_UNAVAILABLE' }, 503);
}

function matchStartConflict(): Response {
  return matchJson({ error: 'MATCH_START_CONFLICT' }, 409);
}

function exactRpcObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function exactState(value: unknown, state: string): boolean {
  return exactRpcObject(value, ['state']) && value.state === state;
}

function invalidatedState(
  value: unknown,
): value is { state: 'invalidated'; invalidatedVersion: number } {
  return (
    exactRpcObject(value, ['state', 'invalidatedVersion']) &&
    value.state === 'invalidated' &&
    typeof value.invalidatedVersion === 'number' &&
    Number.isSafeInteger(value.invalidatedVersion) &&
    value.invalidatedVersion >= 1
  );
}

function reservedNpcMatch(
  value: unknown,
): value is { state: 'reserved'; matchId: string; seed: number; created: boolean } {
  return (
    exactRpcObject(value, ['state', 'matchId', 'seed', 'created']) &&
    value.state === 'reserved' &&
    typeof value.matchId === 'string' &&
    NPC_MATCH_ID_PATTERN.test(value.matchId) &&
    typeof value.seed === 'number' &&
    Number.isSafeInteger(value.seed) &&
    value.seed >= 0 &&
    value.seed <= 0xffff_ffff &&
    typeof value.created === 'boolean'
  );
}

function readyNpcBattle(
  value: unknown,
): value is { state: 'ready'; created: boolean } {
  return (
    exactRpcObject(value, ['state', 'created']) &&
    value.state === 'ready' &&
    typeof value.created === 'boolean'
  );
}

function issuedSeatToken(
  value: unknown,
  nowEpochMs: number,
): value is { state: 'issued'; seatToken: string; expiresAtEpochMs: number } {
  return (
    exactRpcObject(value, ['state', 'seatToken', 'expiresAtEpochMs']) &&
    value.state === 'issued' &&
    typeof value.seatToken === 'string' &&
    isOpaqueToken(value.seatToken) &&
    typeof value.expiresAtEpochMs === 'number' &&
    Number.isSafeInteger(value.expiresAtEpochMs) &&
    value.expiresAtEpochMs > nowEpochMs &&
    value.expiresAtEpochMs <= nowEpochMs + SEAT_TOKEN_TTL_MS
  );
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
  principal: MatchSessionPrincipal,
): Request {
  const headers = new Headers({ Upgrade: 'websocket' });
  headers.set(INTERNAL_ACCOUNT_ID_HEADER, principal.accountId);
  headers.set(INTERNAL_SESSION_ID_HEADER, principal.sessionId);
  headers.set(INTERNAL_SESSION_VERSION_HEADER, String(principal.sessionVersion));
  // Cookie/Origin/client指定のinternal headerをDOへ転送しない。
  return new Request(request.url, { method: 'GET', headers });
}

function route(pathname: string):
  | { kind: 'npc-start'; method: 'POST' }
  | { kind: 'seat-token'; matchId: string; method: 'POST' }
  | { kind: 'websocket'; matchId: string; method: 'GET' }
  | null {
  if (pathname === NPC_MATCH_START_PATH) return { kind: 'npc-start', method: 'POST' };
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

      if (matched.kind === 'seat-token' || matched.kind === 'npc-start') {
        validateUnsafeAuthRequest(request, policy.appOrigin);
        const body = await readAuthJsonObject(request);
        if (!hasOnlyObjectKeys(body, [])) {
          throw new AuthRequestError('AUTH_BODY_INVALID', 400);
        }
      } else {
        validateWebSocketAuthRequest(request, policy.appOrigin);
      }

      if (!dependencies.publicPortEnabled) return matchUnavailable();

      const config = createSessionRuntimeConfig(bindings);
      const profile = resolveCookieProfile(config.appEnvironment, request.url);
      const resolution = await resolvePrincipal(request, config, profile, dependencies);
      if ('response' in resolution) return resolution.response;
      const matchPrincipal: MatchSessionPrincipal = {
        accountId: resolution.principal.accountId,
        sessionId: resolution.principal.sessionId,
        sessionVersion: resolution.principal.sessionVersion,
      };
      const coordinator = dependencies.coordinatorStub(
        bindings,
        matchPrincipal.sessionId,
      );

      if (matched.kind === 'npc-start') {
        const reservation = await coordinator.reserveNpcMatch({
          sessionId: matchPrincipal.sessionId,
          accountId: matchPrincipal.accountId,
          sessionVersion: matchPrincipal.sessionVersion,
        });
        if (invalidatedState(reservation)) return sessionRequired(profile, true);
        if (exactState(reservation, 'conflict')) return matchStartConflict();
        if (!reservedNpcMatch(reservation)) return unavailable();

        const stub = dependencies.matchStub(bindings, reservation.matchId);
        const started = await stub.startNpcBattle({
          principal: matchPrincipal,
          seed: reservation.seed,
        });
        if (exactState(started, 'conflict')) return matchStartConflict();
        if (exactState(started, 'unavailable')) return matchStateUnavailable();
        if (!readyNpcBattle(started)) return unavailable();
        return matchJson(
          { matchId: reservation.matchId },
          started.created ? 201 : 200,
        );
      }

      const membership = await coordinator.checkMatchMembership({
        sessionId: matchPrincipal.sessionId,
        sessionVersion: matchPrincipal.sessionVersion,
        matchId: matched.matchId,
      });
      if (invalidatedState(membership)) return sessionRequired(profile, true);
      if (exactState(membership, 'missing')) return matchUnavailable();
      if (!exactState(membership, 'registered')) return unavailable();

      // membershipがregisteredと確認できるまで、client指定名のMatchDO stubを取得しない。
      const stub = dependencies.matchStub(bindings, matched.matchId);

      if (matched.kind === 'websocket') {
        return await stub.fetch(internalWebSocketRequest(request, matchPrincipal));
      }

      const issued = await stub.issueSeatToken(matchPrincipal);
      if (exactState(issued, 'not_assigned')) return matchUnavailable();
      if (exactState(issued, 'rate_limited')) {
        return matchJson(
          { error: 'MATCH_ACCESS_RATE_LIMITED' },
          429,
          { 'Retry-After': '1' },
        );
      }
      if (!issuedSeatToken(issued, Date.now())) return unavailable();
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
