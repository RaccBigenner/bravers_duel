import { describe, expect, it } from 'vitest';
import {
  createSessionCryptoKeys,
  tokenDigestHex,
  type HmacSecret,
} from '../src/auth/sessionCrypto';
import {
  SEAT_AUTH_FRAME_MAX_BYTES,
  SeatTokenError,
  generateSeatToken,
  parseSeatAuthFrame,
  seatTokenDigestCandidates,
  seatTokenDigestHex,
  verifySeatTokenDigest,
} from '../src/match/seatToken';

function deterministicToken(seed = 0): string {
  return generateSeatToken((bytes) => {
    bytes.forEach((_, index) => {
      bytes[index] = (seed + index) & 0xff;
    });
    return bytes;
  });
}

function hmacSecret(keyVersion = 1, seed = 64): HmacSecret {
  return {
    kind: 'hmac-sha256',
    keyVersion,
    material: deterministicToken(seed),
  };
}

function expectFrameError(
  action: () => unknown,
  code: 'SEAT_AUTH_FRAME_INVALID' | 'SEAT_AUTH_FRAME_TOO_LARGE',
  rawToken?: string,
): void {
  let failure: unknown;
  try {
    action();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(SeatTokenError);
  expect(failure).toMatchObject({ code });
  if (rawToken) expect(String(failure)).not.toContain(rawToken);
}

describe('OLG-113 seat token', () => {
  it('256 bitのcanonical base64url opaque tokenを生成する', () => {
    const token = deterministicToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const decoded = atob(token.replace(/-/g, '+').replace(/_/g, '/') + '=');
    expect(decoded).toHaveLength(32);
    expect(deterministicToken()).toBe(token);
    expect(deterministicToken(1)).not.toBe(token);
  });

  it('seat domainのversion付きHMAC-SHA-256 digestだけを保存用に返す', async () => {
    const token = deterministicToken();
    const secret = hmacSecret();
    const expected = await tokenDigestHex(token, 'seat', secret);

    const digest = await seatTokenDigestHex(token, secret);
    expect(digest).toBe(expected);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(token);
    expect(digest).not.toContain(secret.material);
    await expect(tokenDigestHex(token, 'session', secret)).resolves.not.toBe(digest);
    await expect(tokenDigestHex(token, 'bootstrap', secret)).resolves.not.toBe(digest);
    await expect(
      seatTokenDigestHex(token, { ...secret, keyVersion: secret.keyVersion + 1 }),
    ).resolves.not.toBe(digest);
  });

  it('鍵更新前の発行digestをretained候補に保ち、active-firstで返す', async () => {
    const token = deterministicToken();
    const legacySecret = hmacSecret(1, 40);
    const issuedBeforeRotation = await seatTokenDigestHex(token, legacySecret);
    const keys = createSessionCryptoKeys({
      hmac: {
        activeVersion: 2,
        keys: [
          { keyVersion: 1, material: deterministicToken(40) },
          { keyVersion: 2, material: deterministicToken(41) },
        ],
      },
      encryption: {
        activeVersion: 9,
        keys: [{ keyVersion: 9, material: deterministicToken(90) }],
      },
    });

    const candidates = await seatTokenDigestCandidates(token, keys);
    expect(candidates.map((candidate) => candidate.keyVersion)).toEqual([2, 1]);
    await expect(
      seatTokenDigestHex(token, keys.hmacForVersion(2)!),
    ).resolves.toBe(candidates[0]?.digestHex);
    await expect(
      seatTokenDigestHex(token, keys.hmacForVersion(1)!),
    ).resolves.toBe(candidates[1]?.digestHex);
    expect(candidates[1]?.digestHex).toBe(issuedBeforeRotation);
    expect(Object.isFrozen(candidates)).toBe(true);
    expect(candidates.every(Object.isFrozen)).toBe(true);
    expect(JSON.stringify(candidates)).not.toContain(token);
    expect(JSON.stringify(candidates)).not.toContain(deterministicToken(40));
    expect(JSON.stringify(candidates)).not.toContain(deterministicToken(41));
  });

  it('指定secretの保存digestだけを受理し、別鍵・改変・不正入力を拒否する', async () => {
    const token = deterministicToken();
    const secret = hmacSecret();
    const otherSecret = hmacSecret(2, 65);
    const digest = await seatTokenDigestHex(token, secret);
    const tampered = `${token[0] === 'A' ? 'B' : 'A'}${token.slice(1)}`;

    await expect(verifySeatTokenDigest(token, digest, secret)).resolves.toBe(true);
    await expect(verifySeatTokenDigest(token, digest, otherSecret)).resolves.toBe(false);
    await expect(verifySeatTokenDigest(tampered, digest, secret)).resolves.toBe(false);
    await expect(
      verifySeatTokenDigest('not-a-seat-token', digest, secret),
    ).resolves.toBe(false);
    await expect(
      verifySeatTokenDigest(token, digest.toUpperCase(), secret),
    ).resolves.toBe(false);
  });

  it('最初のauth frameを文字列/UTF-8 bytesから厳密schemaで読む', () => {
    const token = deterministicToken();
    const canonical = JSON.stringify({ type: 'auth', seatToken: token });
    const alternateJsonFormatting = ` { "seatToken": "${token}", "type": "auth" } `;

    expect(parseSeatAuthFrame(canonical)).toEqual({ type: 'auth', seatToken: token });
    expect(
      parseSeatAuthFrame(new TextEncoder().encode(alternateJsonFormatting).buffer),
    ).toEqual({ type: 'auth', seatToken: token });
  });

  it('欠損・余分key・型違い・不正JSON・不正tokenを同じstable errorで拒否する', () => {
    const token = deterministicToken();
    const rejected = [
      '',
      'null',
      '[]',
      '{',
      JSON.stringify({ type: 'auth' }),
      JSON.stringify({ seatToken: token }),
      JSON.stringify({ type: 'command', seatToken: token }),
      JSON.stringify({ type: 'auth', seatToken: token, extra: true }),
      JSON.stringify({ type: 'auth', seatToken: 123 }),
      JSON.stringify({ type: 'auth', seatToken: token.slice(1) }),
    ];

    for (const frame of rejected) {
      expectFrameError(
        () => parseSeatAuthFrame(frame),
        'SEAT_AUTH_FRAME_INVALID',
        token,
      );
    }
  });

  it('不正UTF-8とbyte上限超過をJSON parse前に拒否する', () => {
    const invalidUtf8 = new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x7d]).buffer;
    expectFrameError(
      () => parseSeatAuthFrame(invalidUtf8),
      'SEAT_AUTH_FRAME_INVALID',
    );

    expectFrameError(
      () => parseSeatAuthFrame('a'.repeat(SEAT_AUTH_FRAME_MAX_BYTES + 1)),
      'SEAT_AUTH_FRAME_TOO_LARGE',
    );
    expectFrameError(
      () => parseSeatAuthFrame('あ'.repeat(100)),
      'SEAT_AUTH_FRAME_TOO_LARGE',
    );
    expectFrameError(
      () => parseSeatAuthFrame(new ArrayBuffer(SEAT_AUTH_FRAME_MAX_BYTES + 1)),
      'SEAT_AUTH_FRAME_TOO_LARGE',
    );
  });

  it('生成・digest失敗のerrorへraw tokenやHMAC secretを含めない', async () => {
    expect(() => generateSeatToken(() => new Uint8Array(32))).toThrowError(
      expect.objectContaining({ code: 'SEAT_TOKEN_GENERATION_FAILED' }),
    );

    const raw = 'raw-seat-token-must-not-leak';
    let failure: unknown;
    try {
      await seatTokenDigestHex(raw, hmacSecret());
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SeatTokenError);
    expect(failure).toMatchObject({ code: 'SEAT_TOKEN_INVALID' });
    expect(String(failure)).not.toContain(raw);

    const token = deterministicToken();
    const rawSecret = 'raw-hmac-secret-must-not-leak';
    try {
      await seatTokenDigestHex(token, {
        kind: 'hmac-sha256',
        keyVersion: 1,
        material: rawSecret,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SeatTokenError);
    expect(failure).toMatchObject({ code: 'SEAT_TOKEN_CRYPTO_FAILED' });
    expect(String(failure)).not.toContain(token);
    expect(String(failure)).not.toContain(rawSecret);
  });
});
