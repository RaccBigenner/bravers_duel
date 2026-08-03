import {
  tokenDigestCandidates,
  type SessionCryptoKeys,
} from './sessionCrypto';
import type {
  DigestCandidate,
  SessionPrincipal,
  SessionStore,
} from './supabaseSessionStore';

export interface PrincipalLookup {
  principal: SessionPrincipal;
  matchedCandidate: DigestCandidate;
}

export type SessionLookup =
  | { state: 'missing' }
  | { state: 'ambiguous' }
  | { state: 'integrity_failure' }
  | ({ state: 'ready' } & PrincipalLookup);

/**
 * requestごとにraw cookieから全retained HMAC候補を作り、DBの0/1/>1判定へ渡す。
 * 呼出側は結果をrequest間でcacheせず、権限境界ごとにfresh resolveする。
 */
export async function lookupOpaqueSessionToken(
  token: string,
  store: SessionStore,
  keys: SessionCryptoKeys,
): Promise<SessionLookup> {
  const candidates = await tokenDigestCandidates(token, 'session', keys);
  const resolution = await store.resolveSessionCandidates(candidates);
  if (resolution === null) return { state: 'missing' };
  if ('state' in resolution) return { state: 'ambiguous' };
  const matchedCandidate = candidates.find(
    (candidate) => candidate.keyVersion === resolution.credentialKeyVersion,
  );
  if (!matchedCandidate) return { state: 'integrity_failure' };
  if (store.touchAccountLastActive) {
    const touched = await store.touchAccountLastActive(resolution.accountId);
    if (!touched) return { state: 'integrity_failure' };
  }
  return { state: 'ready', principal: resolution, matchedCandidate };
}
