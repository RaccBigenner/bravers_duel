import {
  createSessionCryptoKeys,
  type SessionCryptoKeys,
  type VersionedKeyMaterial,
} from './sessionCrypto';
import {
  assertAuthServerCredential,
  type AuthServerCredential,
} from './supabaseGuestAuth';
import {
  assertSessionStoreCredential,
  type SessionStoreCredential,
} from './supabaseSessionStore';
import { isExactLocalHostname, isLoopbackHostname } from '../http/urlHostPolicy';

export type AppEnvironment = 'local' | 'development' | 'staging' | 'production';

export interface SessionRuntimeBindings {
  APP_ENV?: unknown;
  APP_ORIGIN?: unknown;
  SUPABASE_URL?: unknown;
  SUPABASE_AUTH_KEY?: unknown;
  SUPABASE_SECRET_KEY?: unknown;
  SESSION_HMAC_KEYS?: unknown;
  SESSION_ENCRYPTION_KEYS?: unknown;
}

export interface SessionRuntimeConfig {
  appEnvironment: AppEnvironment;
  appOrigin: string;
  authCredential: AuthServerCredential;
  storeCredential: SessionStoreCredential;
  cryptoKeys: SessionCryptoKeys;
  captchaRequired: boolean;
}

export interface SessionRequestPolicy {
  appEnvironment: AppEnvironment;
  appOrigin: string;
}

export class SessionRuntimeConfigError extends Error {
  constructor() {
    super('SESSION_RUNTIME_CONFIG_INVALID');
    this.name = 'SessionRuntimeConfigError';
  }
}

const KEYRING_MAX_JSON_LENGTH = 4096;
const APP_ENVIRONMENTS = new Set<AppEnvironment>([
  'local',
  'development',
  'staging',
  'production',
]);

function requiredString(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    value.includes('\0')
  ) {
    throw new SessionRuntimeConfigError();
  }
  return value;
}

function appEnvironment(value: unknown): AppEnvironment {
  const candidate = requiredString(value) as AppEnvironment;
  if (!APP_ENVIRONMENTS.has(candidate)) throw new SessionRuntimeConfigError();
  return candidate;
}

function canonicalAppOrigin(value: unknown, environment: AppEnvironment): string {
  const raw = requiredString(value);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SessionRuntimeConfigError();
  }
  if (
    raw !== url.origin ||
    url.username ||
    url.password ||
    (environment === 'local' &&
      (url.protocol !== 'http:' || !isExactLocalHostname(url.hostname))) ||
    (environment !== 'local' &&
      (url.protocol !== 'https:' || isLoopbackHostname(url.hostname)))
  ) {
    throw new SessionRuntimeConfigError();
  }
  return url.origin;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseKeyring(value: unknown): {
  activeVersion: number;
  keys: readonly VersionedKeyMaterial[];
} {
  const raw = requiredString(value);
  if (raw.length > KEYRING_MAX_JSON_LENGTH) throw new SessionRuntimeConfigError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new SessionRuntimeConfigError();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SessionRuntimeConfigError();
  }
  const keyring = parsed as Record<string, unknown>;
  if (!exactKeys(keyring, ['activeVersion', 'keys']) || !Array.isArray(keyring.keys)) {
    throw new SessionRuntimeConfigError();
  }
  const keys = keyring.keys.map((entry): VersionedKeyMaterial => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new SessionRuntimeConfigError();
    }
    const key = entry as Record<string, unknown>;
    if (
      !exactKeys(key, ['keyVersion', 'material']) ||
      !Number.isSafeInteger(key.keyVersion) ||
      typeof key.material !== 'string'
    ) {
      throw new SessionRuntimeConfigError();
    }
    return { keyVersion: Number(key.keyVersion), material: key.material };
  });
  if (!Number.isSafeInteger(keyring.activeVersion)) {
    throw new SessionRuntimeConfigError();
  }
  return { activeVersion: Number(keyring.activeVersion), keys };
}

/** requestごとにbindingsを検証し、秘密値やCryptoKeyをmodule scopeへ保持しない。 */
export function createSessionRequestPolicy(
  bindings: Pick<SessionRuntimeBindings, 'APP_ENV' | 'APP_ORIGIN'>,
): SessionRequestPolicy {
  try {
    const environment = appEnvironment(bindings.APP_ENV);
    return Object.freeze({
      appEnvironment: environment,
      appOrigin: canonicalAppOrigin(bindings.APP_ORIGIN, environment),
    });
  } catch (error) {
    if (error instanceof SessionRuntimeConfigError) throw error;
    throw new SessionRuntimeConfigError();
  }
}

/** requestごとにbindingsを検証し、秘密値やCryptoKeyをmodule scopeへ保持しない。 */
export function createSessionRuntimeConfig(
  bindings: SessionRuntimeBindings,
): SessionRuntimeConfig {
  try {
    const policy = createSessionRequestPolicy(bindings);
    const environment = policy.appEnvironment;
    const supabaseUrl = requiredString(bindings.SUPABASE_URL);
    const authKey = requiredString(bindings.SUPABASE_AUTH_KEY);
    const secretKey = requiredString(bindings.SUPABASE_SECRET_KEY);
    const cryptoKeys = createSessionCryptoKeys({
      hmac: parseKeyring(bindings.SESSION_HMAC_KEYS),
      encryption: parseKeyring(bindings.SESSION_ENCRYPTION_KEYS),
    });

    const authCredential: AuthServerCredential =
      environment === 'local'
        ? {
            environment: 'local',
            supabaseUrl,
            apiKey: authKey,
            keyMode: 'publishable',
            forwardClientIp: false,
          }
        : {
            environment: 'remote',
            supabaseUrl,
            apiKey: authKey,
            keyMode: 'secret',
            forwardClientIp: true,
          };
    const storeCredential: SessionStoreCredential = {
      environment: environment === 'local' ? 'local' : 'remote',
      supabaseUrl,
      secretKey,
    };
    assertAuthServerCredential(authCredential);
    assertSessionStoreCredential(storeCredential);

    return Object.freeze({
      appEnvironment: environment,
      appOrigin: policy.appOrigin,
      authCredential: Object.freeze(authCredential),
      storeCredential: Object.freeze(storeCredential),
      cryptoKeys,
      captchaRequired: environment !== 'local',
    });
  } catch (error) {
    if (error instanceof SessionRuntimeConfigError) throw error;
    throw new SessionRuntimeConfigError();
  }
}
