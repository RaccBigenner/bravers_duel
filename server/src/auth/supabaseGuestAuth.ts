import { createClient } from '@supabase/supabase-js';
import { createDeadlineFetch } from '../http/deadlineFetch';
import { isExactLocalHostname, isLoopbackHostname } from '../http/urlHostPolicy';

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
  guestBootstrap: {
    attemptId: string;
    claimId: string;
  };
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_ERROR_CODE = /^[a-z0-9_]{1,64}$/;

function normalizedSupabaseUrl(raw: string, environment: 'local' | 'remote'): string {
  if (typeof raw !== 'string') throw new GuestAuthError('AUTH_CONFIG_INVALID', false);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GuestAuthError('AUTH_CONFIG_INVALID', false);
  }

  if (
    (environment === 'local' &&
      (url.protocol !== 'http:' || !isExactLocalHostname(url.hostname))) ||
    (environment === 'remote' &&
      (url.protocol !== 'https:' || isLoopbackHostname(url.hostname))) ||
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
  if (typeof credential?.apiKey !== 'string') {
    throw new GuestAuthError('AUTH_CONFIG_INVALID', false);
  }
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

export function assertAuthServerCredential(credential: AuthServerCredential): void {
  validateCredential(credential);
}

export function normalizedTrustedClientIp(value: string | undefined): string | null {
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

/**
 * Supabase clientはrequestごとに作る。module scopeでsessionを共有しない。
 * 成功したsignupとpublic.account triggerはPostgreSQL上で同じtransactionに属する。
 */
export async function createAnonymousPrincipal(
  credential: AuthServerCredential,
  input: CreateAnonymousPrincipalInput,
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

  const bootstrap = input?.guestBootstrap;
  if (
    !bootstrap ||
    !UUID_PATTERN.test(bootstrap.attemptId) ||
    !UUID_PATTERN.test(bootstrap.claimId)
  ) {
    throw new GuestAuthError('AUTH_CONFIG_INVALID', false);
  }

  if (credential.forwardClientIp) {
    const ip = normalizedTrustedClientIp(input.trustedClientIp);
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
      fetch: createDeadlineFetch(dependencies.fetch ?? fetch, {
        timeoutMs,
        signal: dependencies.signal,
      }),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    },
  });

  let result: Awaited<ReturnType<typeof client.auth.signInAnonymously>>;
  try {
    result = await client.auth.signInAnonymously({
      options: {
        data: {
          guest_bootstrap_attempt_id: bootstrap.attemptId,
          guest_bootstrap_claim_id: bootstrap.claimId,
        },
        ...(captchaToken ? { captchaToken } : {}),
      },
    });
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
