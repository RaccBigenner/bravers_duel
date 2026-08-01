import { isOpaqueToken } from './sessionCrypto';

export const BOOTSTRAP_MAX_AGE_SECONDS = 10 * 60;
export const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export type CookieProfile = 'local-http' | 'secure';
export type SessionCookieKind = 'bootstrap' | 'session';

export type ParsedOpaqueCookie =
  | { state: 'missing' }
  | { state: 'invalid' }
  | { state: 'valid'; token: string };

export class CookieProfileError extends Error {
  constructor() {
    super('COOKIE_PROFILE_INVALID');
    this.name = 'CookieProfileError';
  }
}

export function resolveCookieProfile(appEnv: string, requestUrl: string | URL): CookieProfile {
  let url: URL;
  try {
    url = requestUrl instanceof URL ? requestUrl : new URL(requestUrl);
  } catch {
    throw new CookieProfileError();
  }
  if (url.username || url.password) throw new CookieProfileError();
  const loopback =
    url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (appEnv === 'local') {
    if (url.protocol !== 'http:' || !loopback) throw new CookieProfileError();
    return 'local-http';
  }
  if (!['development', 'staging', 'production'].includes(appEnv)) {
    throw new CookieProfileError();
  }
  if (url.protocol !== 'https:' || loopback) throw new CookieProfileError();
  return 'secure';
}

export function sessionCookieName(kind: SessionCookieKind, profile: CookieProfile): string {
  if (profile === 'local-http') {
    return kind === 'session' ? 'bd_session_local' : 'bd_bootstrap_local';
  }
  return kind === 'session' ? '__Host-bd_session' : '__Host-bd_bootstrap';
}

export function parseOpaqueCookie(
  cookieHeader: string | null,
  kind: SessionCookieKind,
  profile: CookieProfile,
): ParsedOpaqueCookie {
  if (cookieHeader === null || cookieHeader.trim() === '') return { state: 'missing' };
  // WorkersのHeaders.get('Cookie')は重複fieldをcomma結合し得る。cookie-octetに不要な
  // commaを含むheader全体を拒否し、field結合と値の曖昧性をcredential parserへ持ち込まない。
  if (cookieHeader.length > 4096 || cookieHeader.includes(',')) return { state: 'invalid' };
  const expectedName = sessionCookieName(kind, profile);
  const matches: string[] = [];
  const names = new Set<string>();
  for (const [index, rawSegment] of cookieHeader.split(';').entries()) {
    if (rawSegment === '') return { state: 'invalid' };
    const segment = index === 0 ? rawSegment : rawSegment.replace(/^[\t ]+/u, '');
    if (segment === '' || segment !== segment.trimEnd() || (index === 0 && segment !== segment.trimStart())) {
      return { state: 'invalid' };
    }
    const separator = segment.indexOf('=');
    if (separator <= 0) return { state: 'invalid' };
    const name = segment.slice(0, separator);
    const value = segment.slice(separator + 1);
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || names.has(name)) {
      return { state: 'invalid' };
    }
    names.add(name);
    const bareValue = /^(?:[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*)$/u;
    const quotedValue = /^"(?:[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*)"$/u;
    if (!bareValue.test(value) && !quotedValue.test(value)) return { state: 'invalid' };
    if (name === expectedName) matches.push(value);
  }
  if (matches.length === 0) return { state: 'missing' };
  if (matches.length !== 1 || !isOpaqueToken(matches[0])) return { state: 'invalid' };
  return { state: 'valid', token: matches[0] };
}

function attributes(profile: CookieProfile): string {
  return `Path=/; HttpOnly; ${profile === 'secure' ? 'Secure; ' : ''}SameSite=Lax`;
}

export function serializeOpaqueCookie(
  token: string,
  kind: SessionCookieKind,
  profile: CookieProfile,
): string {
  if (!isOpaqueToken(token)) throw new TypeError('Invalid opaque cookie token');
  const maxAge = kind === 'session' ? SESSION_MAX_AGE_SECONDS : BOOTSTRAP_MAX_AGE_SECONDS;
  return `${sessionCookieName(kind, profile)}=${token}; ${attributes(profile)}; Max-Age=${maxAge}`;
}

export function clearOpaqueCookie(
  kind: SessionCookieKind,
  profile: CookieProfile,
): string {
  return `${sessionCookieName(kind, profile)}=; ${attributes(profile)}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
