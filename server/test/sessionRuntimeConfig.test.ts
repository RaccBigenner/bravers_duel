import { describe, expect, it } from 'vitest';
import { generateOpaqueToken } from '../src/auth/sessionCrypto';
import {
  SessionRuntimeConfigError,
  createSessionRequestPolicy,
  createSessionRuntimeConfig,
  type SessionRuntimeBindings,
} from '../src/auth/sessionRuntimeConfig';

const material = (byte: number) =>
  generateOpaqueToken((bytes) => {
    bytes.fill(byte);
    return bytes;
  });

function keyring(keyVersion: number, byte: number): string {
  return JSON.stringify({
    activeVersion: keyVersion,
    keys: [{ keyVersion, material: material(byte) }],
  });
}

function localBindings(): SessionRuntimeBindings {
  return {
    APP_ENV: 'local',
    APP_ORIGIN: 'http://127.0.0.1:8787',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_AUTH_KEY: 'sb_publishable_local-test',
    SUPABASE_SECRET_KEY: 'sb_secret_local-test',
    SESSION_HMAC_KEYS: keyring(2, 2),
    SESSION_ENCRYPTION_KEYS: keyring(3, 3),
  };
}

describe('OLG-113 session runtime config', () => {
  it('local/remoteのorigin・credential・CAPTCHA境界を外部I/O前に固定する', () => {
    const local = createSessionRuntimeConfig(localBindings());
    expect(local).toMatchObject({
      appEnvironment: 'local',
      appOrigin: 'http://127.0.0.1:8787',
      captchaRequired: false,
      authCredential: { environment: 'local', keyMode: 'publishable' },
      storeCredential: { environment: 'local' },
    });

    const remote = createSessionRuntimeConfig({
      ...localBindings(),
      APP_ENV: 'production',
      APP_ORIGIN: 'https://play.racc.games',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_AUTH_KEY: 'sb_secret_remote-auth',
      SUPABASE_SECRET_KEY: 'sb_secret_remote-store',
    });
    expect(remote).toMatchObject({
      appEnvironment: 'production',
      appOrigin: 'https://play.racc.games',
      captchaRequired: true,
      authCredential: { environment: 'remote', keyMode: 'secret', forwardClientIp: true },
      storeCredential: { environment: 'remote' },
    });
  });

  it('origin-only policyは秘密bindingが無くてもsecurity guard用に作れる', () => {
    expect(
      createSessionRequestPolicy({
        APP_ENV: 'development',
        APP_ORIGIN: 'https://dev-play.racc.games',
      }),
    ).toEqual({
      appEnvironment: 'development',
      appOrigin: 'https://dev-play.racc.games',
    });
  });

  it.each([
    { APP_ORIGIN: 'http://example.test' },
    { APP_ORIGIN: 'http://127.0.0.1:8787/' },
    { APP_ENV: 'production', APP_ORIGIN: 'https://127.0.0.1' },
    { APP_ENV: 'production', APP_ORIGIN: 'https://127.0.0.2' },
    { APP_ENV: 'production', APP_ORIGIN: 'https://preview.localhost' },
    { SUPABASE_AUTH_KEY: 'sb_secret_wrong-mode' },
    { SUPABASE_SECRET_KEY: 'sb_publishable_wrong-mode' },
    { SESSION_HMAC_KEYS: '{"activeVersion":1,"keys":[],"extra":true}' },
  ])('不正設定をstable errorだけで拒否する: %j', (override) => {
    const bindings = { ...localBindings(), ...override };
    const sentinel = String(bindings.SUPABASE_SECRET_KEY);
    let failure: unknown;
    try {
      createSessionRuntimeConfig(bindings);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SessionRuntimeConfigError);
    expect(String(failure)).toBe('SessionRuntimeConfigError: SESSION_RUNTIME_CONFIG_INVALID');
    expect(String(failure)).not.toContain(sentinel);
  });

  it('HMAC/AESのmaterial再利用を拒否し、request間で鍵objectを共有しない', () => {
    const bindings = localBindings();
    const first = createSessionRuntimeConfig(bindings);
    const second = createSessionRuntimeConfig(bindings);
    expect(first.cryptoKeys).not.toBe(second.cryptoKeys);
    expect(() =>
      createSessionRuntimeConfig({
        ...bindings,
        SESSION_ENCRYPTION_KEYS: bindings.SESSION_HMAC_KEYS,
      }),
    ).toThrowError(SessionRuntimeConfigError);
  });
});
