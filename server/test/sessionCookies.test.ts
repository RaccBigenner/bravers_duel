import { describe, expect, it } from 'vitest';
import {
  BOOTSTRAP_MAX_AGE_SECONDS,
  SESSION_MAX_AGE_SECONDS,
  clearOpaqueCookie,
  parseOpaqueCookie,
  resolveCookieProfile,
  serializeOpaqueCookie,
  sessionCookieName,
} from '../src/auth/sessionCookies';
import { generateOpaqueToken } from '../src/auth/sessionCrypto';

const token = generateOpaqueToken((bytes) => {
  bytes.fill(3);
  return bytes;
});

describe('OLG-113 opaque cookies', () => {
  it('本番session/bootstrapを__Host-属性で固定する', () => {
    const session = serializeOpaqueCookie(token, 'session', 'secure');
    const bootstrap = serializeOpaqueCookie(token, 'bootstrap', 'secure');

    expect(session).toBe(
      `__Host-bd_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    );
    expect(bootstrap).toBe(
      `__Host-bd_bootstrap=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${BOOTSTRAP_MAX_AGE_SECONDS}`,
    );
    expect(session).not.toContain('Domain=');
  });

  it('HTTP localは本番cookie名を弱い属性で発行しない', () => {
    expect(sessionCookieName('session', 'local-http')).toBe('bd_session_local');
    expect(sessionCookieName('bootstrap', 'local-http')).toBe('bd_bootstrap_local');
    expect(serializeOpaqueCookie(token, 'session', 'local-http')).toBe(
      `bd_session_local=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    );
  });

  it('対象cookieを厳格に読み、順序と他cookieには依存しない', () => {
    expect(
      parseOpaqueCookie(
        `theme=dark; bd_session_local=${token}; locale=ja`,
        'session',
        'local-http',
      ),
    ).toEqual({ state: 'valid', token });
    expect(parseOpaqueCookie('theme=dark', 'session', 'local-http')).toEqual({
      state: 'missing',
    });
    expect(parseOpaqueCookie(null, 'session', 'local-http')).toEqual({ state: 'missing' });
  });

  it('duplicate、空、非canonical値をcredentialとして受理しない', () => {
    expect(
      parseOpaqueCookie(
        `bd_session_local=${token}; bd_session_local=${token}`,
        'session',
        'local-http',
      ),
    ).toEqual({ state: 'invalid' });
    expect(parseOpaqueCookie('bd_session_local=', 'session', 'local-http')).toEqual({
      state: 'invalid',
    });
    expect(parseOpaqueCookie(`bd_session_local=${token}=`, 'session', 'local-http')).toEqual({
      state: 'invalid',
    });
    expect(
      parseOpaqueCookie(
        `bd_session_local=${token}, bd_session_local=${token}`,
        'session',
        'local-http',
      ),
    ).toEqual({ state: 'invalid' });
    expect(
      parseOpaqueCookie(`bd_session_local =${token}`, 'session', 'local-http'),
    ).toEqual({ state: 'invalid' });
    expect(
      parseOpaqueCookie(`bd_session_local= ${token}`, 'session', 'local-http'),
    ).toEqual({ state: 'invalid' });
    expect(
      parseOpaqueCookie(`broken; bd_session_local=${token}`, 'session', 'local-http'),
    ).toEqual({ state: 'invalid' });
    expect(
      parseOpaqueCookie(`bd_session_local=${token};`, 'session', 'local-http'),
    ).toEqual({ state: 'invalid' });
  });

  it('clear cookieも同じscope/security属性を使う', () => {
    expect(clearOpaqueCookie('session', 'secure')).toBe(
      '__Host-bd_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    );
    expect(clearOpaqueCookie('bootstrap', 'local-http')).toBe(
      'bd_bootstrap_local=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    );
  });

  it('APP_ENVとrequest URLの組からcookie profileをfail closedで決める', () => {
    expect(resolveCookieProfile('local', 'http://127.0.0.1:8787/auth/session')).toBe(
      'local-http',
    );
    expect(resolveCookieProfile('production', 'https://play.racc.games/auth/session')).toBe(
      'secure',
    );
    expect(() =>
      resolveCookieProfile('production', 'http://play.racc.games/auth/session'),
    ).toThrow('COOKIE_PROFILE_INVALID');
    expect(() =>
      resolveCookieProfile('local', 'http://example.test/auth/session'),
    ).toThrow('COOKIE_PROFILE_INVALID');
    expect(() => resolveCookieProfile('preview', 'https://preview.example/auth')).toThrow(
      'COOKIE_PROFILE_INVALID',
    );
  });
});
