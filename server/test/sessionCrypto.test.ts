import { describe, expect, it } from 'vitest';
import {
  SessionCryptoError,
  createSessionCryptoKeys,
  decryptAuthGrant,
  deriveSessionToken,
  encryptAuthGrant,
  generateOpaqueToken,
  isOpaqueToken,
  tokenDigestCandidates,
  tokenDigestHex,
  type EncryptionSecret,
  type HmacSecret,
  type VersionedKeyMaterial,
} from '../src/auth/sessionCrypto';

const ACCOUNT_ID = '11111111-2222-4333-8444-555555555555';
const ATTEMPT_ID = '11111111-2222-4333-8444-555555555555';
const SESSION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const material = (byte: number) =>
  generateOpaqueToken((bytes) => {
    bytes.fill(byte);
    return bytes;
  });
const hmacKey = (byte: number, keyVersion = 1): HmacSecret => ({
  kind: 'hmac-sha256',
  keyVersion,
  material: material(byte),
});
const encryptionKey = (byte: number, keyVersion = 1): EncryptionSecret => ({
  kind: 'aes-256-gcm',
  keyVersion,
  material: material(byte),
});

describe('OLG-113 session crypto', () => {
  it('32-byte CSPRNG値だけをcanonical base64url tokenにする', () => {
    const token = generateOpaqueToken((bytes) => {
      bytes.set(Array.from({ length: 32 }, (_, index) => index));
      return bytes;
    });

    expect(token).toBe('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8');
    expect(isOpaqueToken(token)).toBe(true);
    expect(isOpaqueToken(`${token}=`)).toBe(false);
    expect(isOpaqueToken(token.slice(1))).toBe(false);
  });

  it('binary framingのknown-answerを固定し用途driftを検出する', async () => {
    const secret: HmacSecret = {
      kind: 'hmac-sha256',
      keyVersion: 7,
      material: generateOpaqueToken((bytes) => {
        bytes.set(Array.from({ length: 32 }, (_, index) => index));
        return bytes;
      }),
    };
    const bootstrap = generateOpaqueToken((bytes) => {
      bytes.set(Array.from({ length: 32 }, (_, index) => index + 32));
      return bytes;
    });

    expect(bootstrap).toBe('ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8');
    expect(await tokenDigestHex(bootstrap, 'bootstrap', secret)).toBe(
      'f86eb449ac556e31963af868ea22e3894b341000e6bdb703ca46090fc8efa2e8',
    );
    const session = await deriveSessionToken(bootstrap, ATTEMPT_ID, secret);
    expect(session).toBe('ptnxp1bPQYoy3Yr8tgWow1DGoehr7dDl-BaXqXengzY');
    expect(await tokenDigestHex(session, 'session', secret)).toBe(
      'fb3abd2ccb082e8cab036419e6d5ef7e5ee418f1c156aa8b1601ef2f13a58449',
    );
  });

  it('用途、bootstrap、attempt、key versionをそれぞれ分離する', async () => {
    const token = material(7);
    const secret = hmacKey(9);
    const bootstrap = await tokenDigestHex(token, 'bootstrap', secret);
    const session = await tokenDigestHex(token, 'session', secret);

    expect(session).not.toBe(bootstrap);
    expect(await tokenDigestHex(token, 'bootstrap', secret)).toBe(bootstrap);
    expect(await deriveSessionToken(token, ATTEMPT_ID, secret)).not.toBe(
      await deriveSessionToken(token, SESSION_ID, secret),
    );
    expect(await deriveSessionToken(token, ATTEMPT_ID, hmacKey(9, 2))).not.toBe(
      await deriveSessionToken(token, ATTEMPT_ID, secret),
    );
  });

  it('active/retained keyringを分離しversionなしcookieの候補をboundedに列挙する', async () => {
    const oldHmac: VersionedKeyMaterial = { keyVersion: 1, material: material(1) };
    const activeHmac: VersionedKeyMaterial = { keyVersion: 2, material: material(2) };
    const oldEncryption: VersionedKeyMaterial = { keyVersion: 3, material: material(3) };
    const activeEncryption: VersionedKeyMaterial = { keyVersion: 4, material: material(4) };
    const keys = createSessionCryptoKeys({
      hmac: { activeVersion: 2, keys: [activeHmac, oldHmac] },
      encryption: { activeVersion: 4, keys: [activeEncryption, oldEncryption] },
    });

    expect(keys.activeHmac.keyVersion).toBe(2);
    expect(keys.hmacForVersion(1)?.keyVersion).toBe(1);
    expect(keys.hmacCandidates().map((key) => key.keyVersion)).toEqual([2, 1]);
    expect(keys.activeEncryption.keyVersion).toBe(4);
    expect(keys.encryptionForVersion(3)?.keyVersion).toBe(3);
    expect(keys.encryptionForVersion(99)).toBeNull();

    const token = material(9);
    const candidates = await tokenDigestCandidates(token, 'session', keys);
    expect(candidates.map((candidate) => candidate.keyVersion)).toEqual([2, 1]);
    expect(candidates[1]?.digestHex).toBe(
      await tokenDigestHex(token, 'session', keys.hmacForVersion(1)!),
    );

    expect(() =>
      createSessionCryptoKeys({
        hmac: { activeVersion: 1, keys: [oldHmac] },
        encryption: {
          activeVersion: 2,
          keys: [{ keyVersion: 2, material: oldHmac.material }],
        },
      }),
    ).toThrowError(SessionCryptoError);

    expect(() =>
      createSessionCryptoKeys({
        hmac: {
          activeVersion: 1,
          keys: Array.from({ length: 9 }, (_, index) => ({
            keyVersion: index + 1,
            material: material(index + 20),
          })),
        },
        encryption: { activeVersion: 1, keys: [{ keyVersion: 1, material: material(40) }] },
      }),
    ).toThrowError(SessionCryptoError);
  });

  it('Auth grantをAES-GCMで暗号化し、AAD全要素と鍵versionを固定する', async () => {
    const secret = encryptionKey(13, 7);
    const grant = {
      accountId: ACCOUNT_ID,
      accessToken: 'access-token-sentinel',
      refreshToken: 'refresh-token-sentinel',
      expiresAtEpochSeconds: 4_102_444_800,
    };
    const encrypted = await encryptAuthGrant(grant, SESSION_ID, 1, secret, (bytes) => {
      bytes.fill(5);
      return bytes;
    });

    expect(encrypted).toMatchObject({
      schemaVersion: 1,
      keyVersion: 7,
      grantRevision: 1,
      nonceHex: '05'.repeat(12),
    });
    expect(encrypted.ciphertextHex).not.toContain(grant.accessToken);
    await expect(decryptAuthGrant(encrypted, ACCOUNT_ID, SESSION_ID, secret)).resolves.toEqual(
      grant,
    );
    await expect(
      decryptAuthGrant(encrypted, ACCOUNT_ID, SESSION_ID, null),
    ).rejects.toMatchObject({ code: 'SESSION_GRANT_KEY_UNAVAILABLE' });
    await expect(
      decryptAuthGrant(encrypted, ACCOUNT_ID, SESSION_ID, encryptionKey(14, 8)),
    ).rejects.toMatchObject({ code: 'SESSION_GRANT_KEY_UNAVAILABLE' });
    await expect(
      decryptAuthGrant(
        { ...encrypted, grantRevision: 2 },
        ACCOUNT_ID,
        SESSION_ID,
        secret,
      ),
    ).rejects.toMatchObject({ code: 'SESSION_GRANT_INVALID' });
    await expect(
      decryptAuthGrant(
        encrypted,
        'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
        SESSION_ID,
        secret,
      ),
    ).rejects.toMatchObject({ code: 'SESSION_GRANT_INVALID' });
  });

  it('DB ciphertext上限を越えるgrantと非canonical UUIDを暗号化しない', async () => {
    const secret = encryptionKey(13);
    await expect(
      encryptAuthGrant(
        {
          accountId: ACCOUNT_ID,
          accessToken: 'a'.repeat(33_000),
          refreshToken: 'refresh',
          expiresAtEpochSeconds: 4_102_444_800,
        },
        SESSION_ID,
        1,
        secret,
      ),
    ).rejects.toMatchObject({ code: 'SESSION_GRANT_TOO_LARGE' });
    await expect(
      encryptAuthGrant(
        {
          accountId: 'AAAAAAAA-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          accessToken: 'access',
          refreshToken: 'refresh',
          expiresAtEpochSeconds: 4_102_444_800,
        },
        SESSION_ID,
        1,
        secret,
      ),
    ).rejects.toMatchObject({ code: 'SESSION_GRANT_INVALID' });
  });

  it('不正なtoken/鍵をstable errorにして入力値を例外へ出さない', async () => {
    const sentinel = 'raw-secret-sentinel';
    let failure: unknown;
    try {
      await tokenDigestHex(sentinel, 'session', {
        kind: 'hmac-sha256',
        keyVersion: 1,
        material: sentinel,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SessionCryptoError);
    expect(failure).toMatchObject({ code: 'SESSION_TOKEN_INVALID' });
    expect(String(failure)).not.toContain(sentinel);
  });
});
