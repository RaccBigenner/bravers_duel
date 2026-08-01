import { createClient } from '@supabase/supabase-js';

export type AuthKeyMode = 'publishable' | 'secret';

interface BaseAuthServerCredential {
  supabaseUrl: string;
  apiKey: string;
}

export interface LocalAuthServerCredential extends BaseAuthServerCredential {
  environment: 'local';
  keyMode: 'publishable';
  forwardClientIp: false;
}

export interface RemoteAuthServerCredential extends BaseAuthServerCredential {
  environment: 'remote';
  keyMode: 'secret';
  /**
   * remote proxyでSupabase AuthのIP rate limitを実プレイヤー単位に保つ。
   * controllerがCF-Connecting-IPから得た単一IPを必須にする。
   */
  forwardClientIp: true;
}

export type AuthServerCredential = LocalAuthServerCredential | RemoteAuthServerCredential;

export interface CreateAnonymousPrincipalInput {
  captchaToken?: string;
  trustedClientIp?: string;
}

/**
 * OLG-113のserver-side sessionへ即時に収容する内部grant。
 * HTTP body/header/cookie/logへ直接serialize・spreadしてはいけない。
 */
export interface AnonymousAuthGrant {
  accountId: string;
  accessToken: string;
  refreshToken: string;
  expiresAtEpochSeconds: number;
}

export type GuestAuthErrorCode =
  | 'AUTH_CONFIG_INVALID'
  | 'ANONYMOUS_SIGN_IN_REJECTED'
  | 'AUTH_UNAVAILABLE'
  | 'AUTH_RESPONSE_INVALID';

export class GuestAuthError extends Error {
  constructor(
    public readonly code: GuestAuthErrorCode,
    /** trueだけが、同じ操作を再実行しても別accountを作らないと判定できる失敗。 */
    public readonly safeToRetry: boolean,
    public readonly upstreamStatus?: number,
    public readonly upstreamCode?: string,
  ) {
    super(code);
    this.name = 'GuestAuthError';
  }
}

interface GuestAuthDependencies {
  fetch?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  nowMs?: () => number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ERROR_CODE = /^[a-z0-9_]{1,64}$/;

function normalizedSupabaseUrl(raw: string, environment: 'local' | 'remote'): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GuestAuthError('AUTH_CONFIG_INVALID', false);
  }

  const loopback =
    url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (
    (environment === 'local' && (url.protocol !== 'http:' || !loopback)) ||
    (environment === 'remote' && (url.protocol !== 'https:' || loopback)) ||
    url.username ||
    url.password ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    throw new GuestAuthError('AUTH_CONFIG_INVALID', false);
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function validateCredential(credential: AuthServerCredential): string {
  const apiKey = credential.apiKey.trim();
  if (!apiKey) throw new GuestAuthError('AUTH_CONFIG_INVALID', false);
  if (
    (credential.environment === 'local' &&
      (credential.keyMode !== 'publishable' ||
        credential.forwardClientIp !== false ||
        !apiKey.startsWith('sb_publishable_'))) ||
    (credential.environment === 'remote' &&
      (credential.keyMode !== 'secret' ||
        credential.forwardClientIp !== true ||
        !apiKey.startsWith('sb_secret_'))) ||
    (credential.environment !== 'local' && credential.environment !== 'remote')
  ) {
    throw new GuestAuthError('AUTH_CONFIG_INVALID', false);
  }
  return normalizedSupabaseUrl(credential.supabaseUrl, credential.environment);
}

function trustedIpHeader(value: string | undefined): string | null {
  if (!value || value !== value.trim() || value.length > 45 || value.includes(',')) return null;
  const ipv4 = value.split('.');
  if (
    ipv4.length === 4 &&
    ipv4.every(
      (part) =>
        /^\d{1,3}$/.test(part) &&
        Number(part) >= 0 &&
        Number(part) <= 255 &&
        String(Number(part)) === part,
    )
  ) {
    return value;
  }
  if (value.includes(':') && /^[0-9a-f:]+$/i.test(value)) {
    try {
      new URL(`http://[${value}]/`);
      return value;
    } catch {
      return null;
    }
  }
  return null;
}

function safeUpstreamCode(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_ERROR_CODE.test(value) ? value : undefined;
}

function waitWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(signal.reason));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function responseWithDeadline(
  response: Response,
  signal: AbortSignal,
  cleanup: () => void,
): Response {
  const bodyReaders = new Set<PropertyKey>(['arrayBuffer', 'blob', 'formData', 'json', 'text']);
  return new Proxy(response, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (bodyReaders.has(property) && typeof value === 'function') {
        return async (...args: unknown[]) => {
          try {
            const operation = Reflect.apply(value, target, args) as Promise<unknown>;
            return await waitWithAbort(operation, signal);
          } finally {
            cleanup();
          }
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function requestScopedFetch(
  fetchImpl: typeof fetch,
  { timeoutMs, signal }: { timeoutMs: number; signal?: AbortSignal },
): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const abort = (source?: AbortSignal) => {
      if (!controller.signal.aborted) {
        controller.abort(source?.reason ?? new Error('Supabase Auth request aborted'));
      }
    };
    if (signal?.aborted || requestSignal?.aborted) {
      throw signal?.reason ?? requestSignal?.reason ?? new Error('Supabase Auth request aborted');
    }

    const onOuterAbort = () => abort(signal);
    const onRequestAbort = () => abort(requestSignal);
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
      requestSignal?.removeEventListener('abort', onRequestAbort);
    };
    const timer = setTimeout(() => {
      abort();
      cleanup();
    }, timeoutMs);

    signal?.addEventListener('abort', onOuterAbort, { once: true });
    requestSignal?.addEventListener('abort', onRequestAbort, { once: true });

    try {
      const response = await waitWithAbort(
        Promise.resolve(fetchImpl(input, { ...init, signal: controller.signal })),
        controller.signal,
      );
      if (response.body === null) {
        cleanup();
        return response;
      }
      // fetchはheaders到着時点でresolveする。SDKのresponse.json()まで同じdeadlineで覆う。
      return responseWithDeadline(response, controller.signal, cleanup);
    } catch (error) {
      cleanup();
      throw error;
    }
  };
}

/**
 * Supabase clientはrequestごとに作る。module scopeでsessionを共有しない。
 * 成功したsignupとpublic.account triggerはPostgreSQL上で同じtransactionに属する。
 */
export async function createAnonymousPrincipal(
  credential: AuthServerCredential,
  input: CreateAnonymousPrincipalInput = {},
  dependencies: GuestAuthDependencies = {},
): Promise<AnonymousAuthGrant> {
  const supabaseUrl = validateCredential(credential);
  const apiKey = credential.apiKey.trim();
  const headers: Record<string, string> = {};
  const timeoutMs = dependencies.timeoutMs ?? 10_000;
  const nowEpochSeconds = Math.floor((dependencies.nowMs?.() ?? Date.now()) / 1_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new GuestAuthError('AUTH_CONFIG_INVALID', false);
  }

  if (credential.forwardClientIp) {
    const ip = trustedIpHeader(input.trustedClientIp);
    if (!ip) throw new GuestAuthError('AUTH_CONFIG_INVALID', false);
    headers['Sb-Forwarded-For'] = ip;
  }

  const captchaToken = input.captchaToken?.trim();
  if (input.captchaToken !== undefined && (!captchaToken || captchaToken.length > 2048)) {
    throw new GuestAuthError('AUTH_CONFIG_INVALID', false);
  }
  if (dependencies.signal?.aborted) {
    throw new GuestAuthError('AUTH_UNAVAILABLE', false);
  }

  const client = createClient(supabaseUrl, apiKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
      skipAutoInitialize: true,
    },
    global: {
      fetch: requestScopedFetch(dependencies.fetch ?? fetch, {
        timeoutMs,
        signal: dependencies.signal,
      }),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    },
  });

  let result: Awaited<ReturnType<typeof client.auth.signInAnonymously>>;
  try {
    result = await client.auth.signInAnonymously(
      captchaToken ? { options: { captchaToken } } : undefined,
    );
  } catch {
    // signupは冪等ではない。応答だけ失われた可能性があるため、自動再試行させない。
    throw new GuestAuthError('AUTH_UNAVAILABLE', false);
  }

  if (result.error) {
    const status = result.error.status;
    if (status === undefined || status === 0 || status >= 500) {
      throw new GuestAuthError(
        'AUTH_UNAVAILABLE',
        false,
        status,
        safeUpstreamCode(result.error.code),
      );
    }
    throw new GuestAuthError(
      'ANONYMOUS_SIGN_IN_REJECTED',
      status === 429,
      status,
      safeUpstreamCode(result.error.code),
    );
  }

  const { user, session } = result.data;
  if (
    !user ||
    !session ||
    !UUID_PATTERN.test(user.id) ||
    user.is_anonymous !== true ||
    session.user.id !== user.id ||
    session.user.is_anonymous !== true ||
    typeof session.access_token !== 'string' ||
    session.access_token.length === 0 ||
    typeof session.refresh_token !== 'string' ||
    session.refresh_token.length === 0 ||
    session.token_type !== 'bearer' ||
    typeof session.expires_at !== 'number' ||
    !Number.isSafeInteger(session.expires_at) ||
    session.expires_at <= nowEpochSeconds
  ) {
    // 壊れた成功応答でもAuth userが作成済みの可能性がある。
    throw new GuestAuthError('AUTH_RESPONSE_INVALID', false);
  }

  return {
    accountId: user.id,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAtEpochSeconds: session.expires_at,
  };
}
