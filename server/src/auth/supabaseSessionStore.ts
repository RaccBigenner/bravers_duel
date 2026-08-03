import type { EncryptedAuthGrant } from './sessionCrypto';
import { createDeadlineFetch } from '../http/deadlineFetch';
import { isExactLocalHostname, isLoopbackHostname } from '../http/urlHostPolicy';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const MAX_RPC_RESPONSE_LENGTH = 32_768;

export interface SessionStoreCredential {
  environment: 'local' | 'remote';
  supabaseUrl: string;
  secretKey: string;
}

export interface SessionPrincipal {
  sessionId: string;
  accountId: string;
  sessionVersion: number;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  credentialState: 'CURRENT';
  credentialKeyVersion: number;
}

export interface DigestCandidate {
  digestHex: string;
  keyVersion: number;
}

export type SessionResolution = SessionPrincipal | { state: 'ambiguous' } | null;

export type BootstrapClaim =
  | { state: 'invalid' }
  | { state: 'ambiguous' }
  | { state: 'pending'; retryAfterSeconds: number }
  | {
      state: 'create_auth';
      attemptId: string;
      claimId: string;
      sessionDerivationKeyVersion: number;
    }
  | { state: 'recover_auth'; attemptId: string; claimId: string; accountId: string }
  | {
      state: 'session_ready';
      attemptId: string;
      sessionId: string;
      accountId: string;
      sessionVersion: number;
      sessionDerivationKeyVersion: number;
    };

export interface CompletedSession {
  state: 'session_ready';
  attemptId: string;
  sessionId: string;
  accountId: string;
  sessionVersion: number;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

export interface RevokedSession {
  sessionId: string;
  accountId: string;
  sessionVersion: number;
  alreadyRevoked: boolean;
}

export interface SessionStore {
  /** 認証済みrequestの活動時刻をserver側で更新する。未対応storeはcleanup配線前の互換用。 */
  touchAccountLastActive?(accountId: string): Promise<boolean>;
  /** account lock・session/bootstrap再検査・Auth cascade削除をDB側transactionで行う。 */
  deleteGuestIfEligible?(input: { accountId: string; cutoff: string }): Promise<boolean>;
  createBootstrap(input: {
    bootstrapDigestHex: string;
    digestKeyVersion: number;
    sessionDerivationKeyVersion: number;
  }): Promise<{ attemptId: string }>;
  claimBootstrap(input: {
    bootstrapDigestHex: string;
    digestKeyVersion: number;
  }): Promise<BootstrapClaim>;
  claimBootstrapCandidates(
    candidates: readonly DigestCandidate[],
  ): Promise<BootstrapClaim>;
  releaseBootstrapClaim(input: {
    attemptId: string;
    claimId: string;
    safeErrorCode: string;
  }): Promise<boolean>;
  resetBootstrapAfterAuthDelete(input: {
    attemptId: string;
    claimId: string;
    deletedAccountId: string;
  }): Promise<boolean>;
  completeGuestSession(input: {
    attemptId: string;
    claimId: string;
    accountId: string;
    sessionId: string;
    sessionDigestHex: string;
    sessionDigestKeyVersion: number;
    encryptedGrant: EncryptedAuthGrant;
    authGrantExpiresAtEpochSeconds: number;
  }): Promise<CompletedSession | { state: 'invalid' }>;
  resolveSession(input: {
    sessionDigestHex: string;
    sessionDigestKeyVersion: number;
  }): Promise<SessionPrincipal | null>;
  resolveSessionCandidates(candidates: readonly DigestCandidate[]): Promise<SessionResolution>;
  validateSessionVersion(input: { sessionId: string; sessionVersion: number }): Promise<boolean>;
  revokeSession(input: {
    sessionDigestHex: string;
    sessionDigestKeyVersion: number;
    reason: string;
  }): Promise<RevokedSession | null>;
}

export type SessionStoreErrorCode =
  | 'SESSION_STORE_CONFIG_INVALID'
  | 'SESSION_STORE_UNAVAILABLE'
  | 'SESSION_STORE_RESPONSE_INVALID';

export class SessionStoreError extends Error {
  constructor(public readonly code: SessionStoreErrorCode) {
    super(code);
    this.name = 'SessionStoreError';
  }
}

interface SessionStoreDependencies {
  fetch?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function normalizedUrl(credential: SessionStoreCredential): string {
  if (typeof credential?.supabaseUrl !== 'string') {
    throw new SessionStoreError('SESSION_STORE_CONFIG_INVALID');
  }
  let url: URL;
  try {
    url = new URL(credential.supabaseUrl);
  } catch {
    throw new SessionStoreError('SESSION_STORE_CONFIG_INVALID');
  }
  if (
    (credential.environment !== 'local' && credential.environment !== 'remote') ||
    (credential.environment === 'local' &&
      (url.protocol !== 'http:' || !isExactLocalHostname(url.hostname))) ||
    (credential.environment === 'remote' &&
      (url.protocol !== 'https:' || isLoopbackHostname(url.hostname))) ||
    url.username ||
    url.password ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search ||
    url.hash ||
    typeof credential.secretKey !== 'string' ||
    !credential.secretKey.startsWith('sb_secret_') ||
    credential.secretKey !== credential.secretKey.trim()
  ) {
    throw new SessionStoreError('SESSION_STORE_CONFIG_INVALID');
  }
  return url.toString().replace(/\/$/u, '');
}

export function assertSessionStoreCredential(credential: SessionStoreCredential): void {
  normalizedUrl(credential);
}

function positiveSmallint(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 32_767) {
    throw new SessionStoreError('SESSION_STORE_CONFIG_INVALID');
  }
  return value;
}

function safeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new SessionStoreError('SESSION_STORE_RESPONSE_INVALID');
  }
  return Number(value);
}

function responseUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new SessionStoreError('SESSION_STORE_RESPONSE_INVALID');
  }
  return value;
}

function inputUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new SessionStoreError('SESSION_STORE_CONFIG_INVALID');
  return value;
}

function positiveIntegerInput(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new SessionStoreError('SESSION_STORE_CONFIG_INVALID');
  }
  return value;
}

function digest(value: string): string {
  if (!DIGEST_PATTERN.test(value)) throw new SessionStoreError('SESSION_STORE_CONFIG_INVALID');
  return value;
}

function isoTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new SessionStoreError('SESSION_STORE_RESPONSE_INVALID');
  }
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SessionStoreError('SESSION_STORE_RESPONSE_INVALID');
  }
  return value as Record<string, unknown>;
}

function stableCode(value: string): string {
  if (!/^[A-Z0-9_]{1,64}$/.test(value)) {
    throw new SessionStoreError('SESSION_STORE_CONFIG_INVALID');
  }
  return value;
}

function bootstrapClaim(value: Record<string, unknown>): BootstrapClaim {
  if (value.state === 'invalid') return { state: 'invalid' };
  if (value.state === 'ambiguous') return { state: 'ambiguous' };
  if (value.state === 'pending') {
    return { state: 'pending', retryAfterSeconds: safeInteger(value.retry_after_seconds) };
  }
  if (value.state === 'create_auth') {
    return {
      state: 'create_auth',
      attemptId: responseUuid(value.attempt_id),
      claimId: responseUuid(value.claim_id),
      sessionDerivationKeyVersion: positiveSmallint(
        safeInteger(value.session_derivation_key_version),
      ),
    };
  }
  if (value.state === 'recover_auth') {
    return {
      state: 'recover_auth',
      attemptId: responseUuid(value.attempt_id),
      claimId: responseUuid(value.claim_id),
      accountId: responseUuid(value.account_id),
    };
  }
  if (value.state === 'session_ready') {
    return {
      state: 'session_ready',
      attemptId: responseUuid(value.attempt_id),
      sessionId: responseUuid(value.session_id),
      accountId: responseUuid(value.account_id),
      sessionVersion: safeInteger(value.session_version),
      sessionDerivationKeyVersion: positiveSmallint(
        safeInteger(value.session_derivation_key_version),
      ),
    };
  }
  throw new SessionStoreError('SESSION_STORE_RESPONSE_INVALID');
}

function digestCandidateBody(
  candidates: readonly DigestCandidate[],
): readonly { digest_hex: string; digest_key_version: number }[] {
  if (candidates.length < 1 || candidates.length > 8) {
    throw new SessionStoreError('SESSION_STORE_CONFIG_INVALID');
  }
  const seen = new Set<string>();
  return candidates.map((candidate) => {
    const digestHex = digest(candidate.digestHex);
    const keyVersion = positiveSmallint(candidate.keyVersion);
    const identity = `${keyVersion}:${digestHex}`;
    if (seen.has(identity)) throw new SessionStoreError('SESSION_STORE_CONFIG_INVALID');
    seen.add(identity);
    return { digest_hex: digestHex, digest_key_version: keyVersion };
  });
}

function sessionResolution(raw: unknown): SessionResolution {
  if (raw === null) return null;
  const value = object(raw);
  if (value.state === 'ambiguous') return { state: 'ambiguous' };
  if (value.credential_state !== 'CURRENT') {
    throw new SessionStoreError('SESSION_STORE_RESPONSE_INVALID');
  }
  return {
    sessionId: responseUuid(value.session_id),
    accountId: responseUuid(value.account_id),
    sessionVersion: safeInteger(value.session_version),
    idleExpiresAt: isoTimestamp(value.idle_expires_at),
    absoluteExpiresAt: isoTimestamp(value.absolute_expires_at),
    credentialState: 'CURRENT',
    credentialKeyVersion: positiveSmallint(safeInteger(value.credential_key_version)),
  };
}

export class SupabaseSessionStore implements SessionStore {
  readonly #baseUrl: string;
  readonly #secretKey: string;
  readonly #fetch: typeof fetch;

  constructor(
    credential: SessionStoreCredential,
    dependencies: SessionStoreDependencies = {},
  ) {
    this.#baseUrl = normalizedUrl(credential);
    this.#secretKey = credential.secretKey;
    try {
      this.#fetch = createDeadlineFetch(dependencies.fetch ?? fetch, {
        timeoutMs: dependencies.timeoutMs ?? 10_000,
        signal: dependencies.signal,
      });
    } catch {
      throw new SessionStoreError('SESSION_STORE_CONFIG_INVALID');
    }
  }

  async #rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          apikey: this.#secretKey,
          Authorization: `Bearer ${this.#secretKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new SessionStoreError('SESSION_STORE_UNAVAILABLE');
    }

    const declaredLength = Number(response.headers.get('Content-Length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RPC_RESPONSE_LENGTH) {
      throw new SessionStoreError('SESSION_STORE_RESPONSE_INVALID');
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new SessionStoreError('SESSION_STORE_UNAVAILABLE');
    }
    if (!response.ok) throw new SessionStoreError('SESSION_STORE_UNAVAILABLE');
    if (text.length > MAX_RPC_RESPONSE_LENGTH) {
      throw new SessionStoreError('SESSION_STORE_RESPONSE_INVALID');
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new SessionStoreError('SESSION_STORE_RESPONSE_INVALID');
    }
  }

  async createBootstrap(input: {
    bootstrapDigestHex: string;
    digestKeyVersion: number;
    sessionDerivationKeyVersion: number;
  }): Promise<{ attemptId: string }> {
    const value = object(
      await this.#rpc('create_guest_bootstrap_attempt', {
        p_bootstrap_digest_hex: digest(input.bootstrapDigestHex),
        p_digest_key_version: positiveSmallint(input.digestKeyVersion),
        p_session_derivation_key_version: positiveSmallint(
          input.sessionDerivationKeyVersion,
        ),
      }),
    );
    if (value.state !== 'created') throw new SessionStoreError('SESSION_STORE_RESPONSE_INVALID');
    return { attemptId: responseUuid(value.attempt_id) };
  }

  async claimBootstrap(input: {
    bootstrapDigestHex: string;
    digestKeyVersion: number;
  }): Promise<BootstrapClaim> {
    return bootstrapClaim(object(
      await this.#rpc('claim_guest_bootstrap_attempt', {
        p_bootstrap_digest_hex: digest(input.bootstrapDigestHex),
        p_digest_key_version: positiveSmallint(input.digestKeyVersion),
      }),
    ));
  }

  async claimBootstrapCandidates(
    candidates: readonly DigestCandidate[],
  ): Promise<BootstrapClaim> {
    const body = digestCandidateBody(candidates);
    return bootstrapClaim(
      object(
        await this.#rpc('claim_guest_bootstrap_attempt_candidates', {
          p_candidates: body,
        }),
      ),
    );
  }

  async releaseBootstrapClaim(input: {
    attemptId: string;
    claimId: string;
    safeErrorCode: string;
  }): Promise<boolean> {
    const result = await this.#rpc('release_guest_bootstrap_claim', {
      p_attempt_id: inputUuid(input.attemptId),
      p_claim_id: inputUuid(input.claimId),
      p_safe_error_code: stableCode(input.safeErrorCode),
    });
    if (typeof result !== 'boolean') {
      throw new SessionStoreError('SESSION_STORE_RESPONSE_INVALID');
    }
    return result;
  }

  async resetBootstrapAfterAuthDelete(input: {
    attemptId: string;
    claimId: string;
    deletedAccountId: string;
  }): Promise<boolean> {
    const result = await this.#rpc('reset_guest_bootstrap_after_auth_delete', {
      p_attempt_id: inputUuid(input.attemptId),
      p_claim_id: inputUuid(input.claimId),
      p_deleted_account_id: inputUuid(input.deletedAccountId),
    });
    if (typeof result !== 'boolean') {
      throw new SessionStoreError('SESSION_STORE_RESPONSE_INVALID');
    }
    return result;
  }

  async completeGuestSession(input: {
    attemptId: string;
    claimId: string;
    accountId: string;
    sessionId: string;
    sessionDigestHex: string;
    sessionDigestKeyVersion: number;
    encryptedGrant: EncryptedAuthGrant;
    authGrantExpiresAtEpochSeconds: number;
  }): Promise<CompletedSession | { state: 'invalid' }> {
    if (
      input.encryptedGrant.schemaVersion !== 1 ||
      input.encryptedGrant.grantRevision !== 1 ||
      !/^[0-9a-f]{34,65536}$/.test(input.encryptedGrant.ciphertextHex) ||
      input.encryptedGrant.ciphertextHex.length % 2 !== 0 ||
      !/^[0-9a-f]{24}$/.test(input.encryptedGrant.nonceHex) ||
      !Number.isSafeInteger(input.authGrantExpiresAtEpochSeconds) ||
      input.authGrantExpiresAtEpochSeconds < 1
    ) {
      throw new SessionStoreError('SESSION_STORE_CONFIG_INVALID');
    }
    const value = object(
      await this.#rpc('complete_guest_app_session', {
        p_attempt_id: inputUuid(input.attemptId),
        p_claim_id: inputUuid(input.claimId),
        p_account_id: inputUuid(input.accountId),
        p_session_id: inputUuid(input.sessionId),
        p_token_digest_hex: digest(input.sessionDigestHex),
        p_token_digest_key_version: positiveSmallint(input.sessionDigestKeyVersion),
        p_auth_grant_ciphertext_hex: input.encryptedGrant.ciphertextHex,
        p_auth_grant_nonce_hex: input.encryptedGrant.nonceHex,
        p_auth_grant_key_version: positiveSmallint(input.encryptedGrant.keyVersion),
        p_auth_grant_expires_at_epoch: input.authGrantExpiresAtEpochSeconds,
      }),
    );
    if (value.state === 'invalid') return { state: 'invalid' };
    if (value.state !== 'session_ready') {
      throw new SessionStoreError('SESSION_STORE_RESPONSE_INVALID');
    }
    return {
      state: 'session_ready',
      attemptId: responseUuid(value.attempt_id),
      sessionId: responseUuid(value.session_id),
      accountId: responseUuid(value.account_id),
      sessionVersion: safeInteger(value.session_version),
      idleExpiresAt: isoTimestamp(value.idle_expires_at),
      absoluteExpiresAt: isoTimestamp(value.absolute_expires_at),
    };
  }

  async resolveSession(input: {
    sessionDigestHex: string;
    sessionDigestKeyVersion: number;
  }): Promise<SessionPrincipal | null> {
    const result = sessionResolution(await this.#rpc('resolve_app_session', {
      p_token_digest_hex: digest(input.sessionDigestHex),
      p_token_digest_key_version: positiveSmallint(input.sessionDigestKeyVersion),
    }));
    if (result && 'state' in result) {
      throw new SessionStoreError('SESSION_STORE_RESPONSE_INVALID');
    }
    return result;
  }

  async touchAccountLastActive(accountId: string): Promise<boolean> {
    const raw = await this.#rpc('touch_account_last_active', {
      p_account_id: inputUuid(accountId),
    });
    if (typeof raw !== 'boolean') {
      throw new SessionStoreError('SESSION_STORE_RESPONSE_INVALID');
    }
    return raw;
  }

  async deleteGuestIfEligible(input: { accountId: string; cutoff: string }): Promise<boolean> {
    const raw = await this.#rpc('delete_guest_if_eligible', {
      p_account_id: inputUuid(input.accountId),
      p_cutoff: input.cutoff,
    });
    if (typeof raw !== 'boolean') {
      throw new SessionStoreError('SESSION_STORE_RESPONSE_INVALID');
    }
    return raw;
  }

  async resolveSessionCandidates(
    candidates: readonly DigestCandidate[],
  ): Promise<SessionResolution> {
    return sessionResolution(
      await this.#rpc('resolve_app_session_candidates', {
        p_candidates: digestCandidateBody(candidates),
      }),
    );
  }

  async validateSessionVersion(input: {
    sessionId: string;
    sessionVersion: number;
  }): Promise<boolean> {
    const result = await this.#rpc('validate_app_session_version', {
      p_session_id: inputUuid(input.sessionId),
      p_session_version: positiveIntegerInput(input.sessionVersion),
    });
    if (typeof result !== 'boolean') {
      throw new SessionStoreError('SESSION_STORE_RESPONSE_INVALID');
    }
    return result;
  }

  async revokeSession(input: {
    sessionDigestHex: string;
    sessionDigestKeyVersion: number;
    reason: string;
  }): Promise<RevokedSession | null> {
    const raw = await this.#rpc('revoke_app_session', {
      p_token_digest_hex: digest(input.sessionDigestHex),
      p_token_digest_key_version: positiveSmallint(input.sessionDigestKeyVersion),
      p_revoke_reason: stableCode(input.reason),
    });
    if (raw === null) return null;
    const value = object(raw);
    if (typeof value.already_revoked !== 'boolean') {
      throw new SessionStoreError('SESSION_STORE_RESPONSE_INVALID');
    }
    return {
      sessionId: responseUuid(value.session_id),
      accountId: responseUuid(value.account_id),
      sessionVersion: safeInteger(value.session_version),
      alreadyRevoked: value.already_revoked,
    };
  }
}
