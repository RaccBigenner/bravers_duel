import type { AnonymousAuthGrant } from './supabaseGuestAuth';

const TOKEN_BYTES = 32;
const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const MAX_AUTH_GRANT_CIPHERTEXT_BYTES = 32_768;
const MAX_AUTH_GRANT_PLAINTEXT_BYTES = MAX_AUTH_GRANT_CIPHERTEXT_BYTES - AES_GCM_TAG_BYTES;
const MAX_KEYS_PER_KEYRING = 8;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HEX_PATTERN = /^[0-9a-f]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export const SESSION_CRYPTO_FORMAT_VERSION = 1 as const;

export type TokenDigestPurpose = 'bootstrap' | 'session' | 'seat';

export interface VersionedKeyMaterial {
  keyVersion: number;
  material: string;
}

export interface HmacSecret extends VersionedKeyMaterial {
  kind: 'hmac-sha256';
}

export interface EncryptionSecret extends VersionedKeyMaterial {
  kind: 'aes-256-gcm';
}

export interface SessionCryptoKeys {
  activeHmac: HmacSecret;
  activeEncryption: EncryptionSecret;
  /** active first, retainedはversion降順。cookieにversionを含めないためlookup時だけboundedに使う。 */
  hmacCandidates(): readonly HmacSecret[];
  hmacForVersion(keyVersion: number): HmacSecret | null;
  encryptionForVersion(keyVersion: number): EncryptionSecret | null;
}

export interface EncryptedAuthGrant {
  schemaVersion: typeof SESSION_CRYPTO_FORMAT_VERSION;
  keyVersion: number;
  grantRevision: number;
  ciphertextHex: string;
  nonceHex: string;
}

export interface TokenDigestCandidate {
  keyVersion: number;
  digestHex: string;
}

export type SessionCryptoErrorCode =
  | 'SESSION_CRYPTO_CONFIG_INVALID'
  | 'SESSION_TOKEN_INVALID'
  | 'SESSION_GRANT_INVALID'
  | 'SESSION_GRANT_TOO_LARGE'
  | 'SESSION_GRANT_KEY_UNAVAILABLE';

export class SessionCryptoError extends Error {
  constructor(public readonly code: SessionCryptoErrorCode) {
    super(code);
    this.name = 'SessionCryptoError';
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64UrlToBytes(
  value: string,
  expectedLength: number,
  errorCode: SessionCryptoErrorCode = 'SESSION_CRYPTO_CONFIG_INVALID',
): Uint8Array {
  if (!TOKEN_PATTERN.test(value)) throw new SessionCryptoError(errorCode);
  let binary: string;
  try {
    binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '=');
  } catch {
    throw new SessionCryptoError(errorCode);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength !== expectedLength || bytesToBase64Url(bytes) !== value) {
    throw new SessionCryptoError(errorCode);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function hexToBytes(value: string, expectedLength?: number): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 2 !== 0 ||
    !HEX_PATTERN.test(value) ||
    (expectedLength !== undefined && value.length !== expectedLength * 2)
  ) {
    throw new SessionCryptoError('SESSION_GRANT_INVALID');
  }
  const result = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    result[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return result;
}

function u32be(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new SessionCryptoError('SESSION_CRYPTO_CONFIG_INVALID');
  }
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, false);
  return result;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

/** domain + NUL + key version + counted length-prefixed fields. */
function cryptoFrame(domain: string, keyVersion: number, fields: readonly Uint8Array[]): Uint8Array {
  const domainBytes = textEncoder.encode(domain);
  return concatBytes([
    domainBytes,
    new Uint8Array([0]),
    u32be(keyVersion),
    u32be(fields.length),
    ...fields.flatMap((field) => [u32be(field.byteLength), field]),
  ]);
}

function assertKeyVersion(keyVersion: number): void {
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1 || keyVersion > 32_767) {
    throw new SessionCryptoError('SESSION_CRYPTO_CONFIG_INVALID');
  }
}

function keyMaterialBytes(key: VersionedKeyMaterial): Uint8Array {
  assertKeyVersion(key.keyVersion);
  return base64UrlToBytes(key.material, TOKEN_BYTES);
}

function buildKeyMap<T extends VersionedKeyMaterial>(
  values: readonly T[],
  activeVersion: number,
  allMaterial: Set<string>,
): { active: T; byVersion: ReadonlyMap<number, T> } {
  assertKeyVersion(activeVersion);
  if (values.length === 0 || values.length > MAX_KEYS_PER_KEYRING) {
    throw new SessionCryptoError('SESSION_CRYPTO_CONFIG_INVALID');
  }
  const byVersion = new Map<number, T>();
  for (const value of values) {
    keyMaterialBytes(value);
    if (byVersion.has(value.keyVersion) || allMaterial.has(value.material)) {
      throw new SessionCryptoError('SESSION_CRYPTO_CONFIG_INVALID');
    }
    byVersion.set(value.keyVersion, Object.freeze({ ...value }));
    allMaterial.add(value.material);
  }
  const active = byVersion.get(activeVersion);
  if (!active) throw new SessionCryptoError('SESSION_CRYPTO_CONFIG_INVALID');
  return { active, byVersion };
}

/**
 * requestごとにsecret bindingから構築する。module scopeでCryptoKeyをcacheせず、HMAC/AESや
 * version間に同じmaterialを誤配線した設定もfail closedする。
 */
export function createSessionCryptoKeys(input: {
  hmac: { activeVersion: number; keys: readonly VersionedKeyMaterial[] };
  encryption: { activeVersion: number; keys: readonly VersionedKeyMaterial[] };
}): SessionCryptoKeys {
  const allMaterial = new Set<string>();
  const hmacValues = input.hmac.keys.map(
    (key): HmacSecret => ({ ...key, kind: 'hmac-sha256' }),
  );
  const encryptionValues = input.encryption.keys.map(
    (key): EncryptionSecret => ({ ...key, kind: 'aes-256-gcm' }),
  );
  const hmac = buildKeyMap(hmacValues, input.hmac.activeVersion, allMaterial);
  const encryption = buildKeyMap(
    encryptionValues,
    input.encryption.activeVersion,
    allMaterial,
  );
  const hmacCandidates = Object.freeze([
    hmac.active,
    ...[...hmac.byVersion.values()]
      .filter((key) => key.keyVersion !== hmac.active.keyVersion)
      .sort((left, right) => right.keyVersion - left.keyVersion),
  ]);
  return Object.freeze({
    activeHmac: hmac.active,
    activeEncryption: encryption.active,
    hmacCandidates: () => hmacCandidates,
    hmacForVersion: (keyVersion: number) => hmac.byVersion.get(keyVersion) ?? null,
    encryptionForVersion: (keyVersion: number) =>
      encryption.byVersion.get(keyVersion) ?? null,
  });
}

async function importHmacSecret(secret: HmacSecret): Promise<CryptoKey> {
  if (secret.kind !== 'hmac-sha256') {
    throw new SessionCryptoError('SESSION_CRYPTO_CONFIG_INVALID');
  }
  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyMaterialBytes(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function importEncryptionSecret(
  secret: EncryptionSecret,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  if (secret.kind !== 'aes-256-gcm') {
    throw new SessionCryptoError('SESSION_CRYPTO_CONFIG_INVALID');
  }
  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyMaterialBytes(secret)),
    { name: 'AES-GCM' },
    false,
    usages,
  );
}

function tokenDomain(purpose: TokenDigestPurpose): string {
  return `bravers-duel/token/${purpose}-verifier/v1`;
}

function canonicalUuid(value: string, errorCode: SessionCryptoErrorCode): string {
  if (!UUID_PATTERN.test(value)) throw new SessionCryptoError(errorCode);
  return value;
}

function grantAad(
  accountId: string,
  sessionId: string,
  keyVersion: number,
  grantRevision: number,
): Uint8Array {
  canonicalUuid(accountId, 'SESSION_GRANT_INVALID');
  canonicalUuid(sessionId, 'SESSION_GRANT_INVALID');
  if (!Number.isSafeInteger(grantRevision) || grantRevision < 1) {
    throw new SessionCryptoError('SESSION_GRANT_INVALID');
  }
  return cryptoFrame('bravers-duel/auth-grant/v1', keyVersion, [
    textEncoder.encode(accountId),
    textEncoder.encode(sessionId),
    u32be(grantRevision),
  ]);
}

function grantPlaintext(grant: AnonymousAuthGrant): Uint8Array {
  if (
    canonicalUuid(grant.accountId, 'SESSION_GRANT_INVALID') !== grant.accountId ||
    typeof grant.accessToken !== 'string' ||
    grant.accessToken.length === 0 ||
    typeof grant.refreshToken !== 'string' ||
    grant.refreshToken.length === 0 ||
    !Number.isSafeInteger(grant.expiresAtEpochSeconds) ||
    grant.expiresAtEpochSeconds < 1
  ) {
    throw new SessionCryptoError('SESSION_GRANT_INVALID');
  }
  const plaintext = textEncoder.encode(
    JSON.stringify({
      accountId: grant.accountId,
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
      expiresAtEpochSeconds: grant.expiresAtEpochSeconds,
    }),
  );
  if (plaintext.byteLength > MAX_AUTH_GRANT_PLAINTEXT_BYTES) {
    throw new SessionCryptoError('SESSION_GRANT_TOO_LARGE');
  }
  return plaintext;
}

function parseGrant(value: unknown): AnonymousAuthGrant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SessionCryptoError('SESSION_GRANT_INVALID');
  }
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).length !== 4 ||
    typeof candidate.accountId !== 'string' ||
    !UUID_PATTERN.test(candidate.accountId) ||
    typeof candidate.accessToken !== 'string' ||
    candidate.accessToken.length === 0 ||
    typeof candidate.refreshToken !== 'string' ||
    candidate.refreshToken.length === 0 ||
    !Number.isSafeInteger(candidate.expiresAtEpochSeconds) ||
    Number(candidate.expiresAtEpochSeconds) < 1
  ) {
    throw new SessionCryptoError('SESSION_GRANT_INVALID');
  }
  return {
    accountId: candidate.accountId,
    accessToken: candidate.accessToken,
    refreshToken: candidate.refreshToken,
    expiresAtEpochSeconds: Number(candidate.expiresAtEpochSeconds),
  };
}

export function isOpaqueToken(value: string): boolean {
  if (!TOKEN_PATTERN.test(value)) return false;
  try {
    return bytesToBase64Url(base64UrlToBytes(value, TOKEN_BYTES)) === value;
  } catch {
    return false;
  }
}

export function generateOpaqueToken(
  fillRandom: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  if (fillRandom(bytes) !== bytes) {
    throw new SessionCryptoError('SESSION_CRYPTO_CONFIG_INVALID');
  }
  return bytesToBase64Url(bytes);
}

export async function tokenDigestHex(
  token: string,
  purpose: TokenDigestPurpose,
  secret: HmacSecret,
): Promise<string> {
  const tokenBytes = base64UrlToBytes(token, TOKEN_BYTES, 'SESSION_TOKEN_INVALID');
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importHmacSecret(secret),
    toArrayBuffer(cryptoFrame(tokenDomain(purpose), secret.keyVersion, [tokenBytes])),
  );
  return bytesToHex(new Uint8Array(signature));
}

/** versionなしcookieをactive+retained keyringへ照合するためのbounded候補を作る。 */
export async function tokenDigestCandidates(
  token: string,
  purpose: TokenDigestPurpose,
  keys: SessionCryptoKeys,
): Promise<readonly TokenDigestCandidate[]> {
  const candidates = await Promise.all(
    keys.hmacCandidates().map(async (secret) => ({
      keyVersion: secret.keyVersion,
      digestHex: await tokenDigestHex(token, purpose, secret),
    })),
  );
  return Object.freeze(candidates.map((candidate) => Object.freeze(candidate)));
}

/**
 * bootstrap cookieを持つ同一browserだけが、応答喪失後も同じsession credentialを回収できる。
 * raw bootstrap/sessionはいずれもDBへ保存しない。
 */
export async function deriveSessionToken(
  bootstrapToken: string,
  attemptId: string,
  secret: HmacSecret,
): Promise<string> {
  const bootstrapBytes = base64UrlToBytes(
    bootstrapToken,
    TOKEN_BYTES,
    'SESSION_TOKEN_INVALID',
  );
  canonicalUuid(attemptId, 'SESSION_TOKEN_INVALID');
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importHmacSecret(secret),
    toArrayBuffer(
      cryptoFrame('bravers-duel/token/session-derive/v1', secret.keyVersion, [
        textEncoder.encode(attemptId),
        bootstrapBytes,
      ]),
    ),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function encryptAuthGrant(
  grant: AnonymousAuthGrant,
  sessionId: string,
  grantRevision: number,
  secret: EncryptionSecret,
  fillRandom: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): Promise<EncryptedAuthGrant> {
  const plaintext = grantPlaintext(grant);
  const nonce = new Uint8Array(AES_GCM_NONCE_BYTES);
  if (fillRandom(nonce) !== nonce) {
    throw new SessionCryptoError('SESSION_CRYPTO_CONFIG_INVALID');
  }
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(
        grantAad(grant.accountId, sessionId, secret.keyVersion, grantRevision),
      ),
    },
    await importEncryptionSecret(secret, ['encrypt']),
    toArrayBuffer(plaintext),
  );
  return {
    schemaVersion: SESSION_CRYPTO_FORMAT_VERSION,
    keyVersion: secret.keyVersion,
    grantRevision,
    ciphertextHex: bytesToHex(new Uint8Array(ciphertext)),
    nonceHex: bytesToHex(nonce),
  };
}

export async function decryptAuthGrant(
  encrypted: EncryptedAuthGrant,
  accountId: string,
  sessionId: string,
  secret: EncryptionSecret | null,
): Promise<AnonymousAuthGrant> {
  if (!secret || encrypted.keyVersion !== secret.keyVersion) {
    throw new SessionCryptoError('SESSION_GRANT_KEY_UNAVAILABLE');
  }
  if (encrypted.schemaVersion !== SESSION_CRYPTO_FORMAT_VERSION) {
    throw new SessionCryptoError('SESSION_GRANT_INVALID');
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(hexToBytes(encrypted.nonceHex, AES_GCM_NONCE_BYTES)),
        additionalData: toArrayBuffer(
          grantAad(accountId, sessionId, encrypted.keyVersion, encrypted.grantRevision),
        ),
      },
      await importEncryptionSecret(secret, ['decrypt']),
      toArrayBuffer(hexToBytes(encrypted.ciphertextHex)),
    );
    return parseGrant(JSON.parse(textDecoder.decode(plaintext)));
  } catch (error) {
    if (error instanceof SessionCryptoError) throw error;
    throw new SessionCryptoError('SESSION_GRANT_INVALID');
  }
}
