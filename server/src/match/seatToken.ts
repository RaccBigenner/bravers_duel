import {
  MATCH_PLAYER_PROJECTION_VERSION,
  MATCH_VIEWER_EVENT_VERSION,
} from '@bravers/protocol';
import {
  generateOpaqueToken,
  isOpaqueToken,
  tokenDigestCandidates,
  tokenDigestHex,
  type HmacSecret,
  type SessionCryptoKeys,
  type TokenDigestCandidate,
} from '../auth/sessionCrypto';

export const SEAT_AUTH_FRAME_MAX_BYTES = 256;

const SHA256_DIGEST_HEX = /^[0-9a-f]{64}$/;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export type SeatTokenErrorCode =
  | 'SEAT_TOKEN_GENERATION_FAILED'
  | 'SEAT_TOKEN_INVALID'
  | 'SEAT_TOKEN_CRYPTO_FAILED'
  | 'SEAT_AUTH_FRAME_INVALID'
  | 'SEAT_AUTH_FRAME_TOO_LARGE';

export class SeatTokenError extends Error {
  constructor(public readonly code: SeatTokenErrorCode) {
    super(code);
    this.name = 'SeatTokenError';
  }
}

export interface SeatAuthFrame {
  readonly type: 'auth';
  readonly seatToken: string;
  readonly resume: null | SeatAuthResume;
}

export interface SeatAuthResume {
  readonly projectionVersion: typeof MATCH_PLAYER_PROJECTION_VERSION;
  readonly viewerEventVersion: typeof MATCH_VIEWER_EVENT_VERSION;
  readonly lastEventSequence: number;
}

function assertSeatToken(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !isOpaqueToken(value)) {
    throw new SeatTokenError('SEAT_TOKEN_INVALID');
  }
}

/** 256 bitのraw token。発行応答以外へ保存・記録してはいけない。 */
export function generateSeatToken(
  fillRandom?: (bytes: Uint8Array) => Uint8Array,
): string {
  try {
    return fillRandom ? generateOpaqueToken(fillRandom) : generateOpaqueToken();
  } catch {
    throw new SeatTokenError('SEAT_TOKEN_GENERATION_FAILED');
  }
}

/**
 * MatchDOへ保存する値。raw tokenは永続化せず、このHMAC-SHA-256 digestと
 * secret.keyVersionだけを保存する。
 */
export async function seatTokenDigestHex(
  token: string,
  secret: HmacSecret,
): Promise<string> {
  assertSeatToken(token);
  try {
    return await tokenDigestHex(token, 'seat', secret);
  } catch {
    throw new SeatTokenError('SEAT_TOKEN_CRYPTO_FAILED');
  }
}

/**
 * versionなしraw tokenをactive+retained keyringへ照合するbounded候補。
 * MatchDOはこの全候補を1 transactionで照合し、0/1/>1件を原子的に判定する。
 */
export async function seatTokenDigestCandidates(
  token: string,
  keys: SessionCryptoKeys,
): Promise<readonly TokenDigestCandidate[]> {
  assertSeatToken(token);
  try {
    return await tokenDigestCandidates(token, 'seat', keys);
  } catch {
    throw new SeatTokenError('SEAT_TOKEN_CRYPTO_FAILED');
  }
}

/** digestとの一致だけを検査する。期限・match/seat・一回性の代用にはしない。 */
export async function verifySeatTokenDigest(
  token: string,
  expectedDigestHex: string,
  secret: HmacSecret,
): Promise<boolean> {
  if (!isOpaqueToken(token) || !SHA256_DIGEST_HEX.test(expectedDigestHex)) return false;

  const actualDigestHex = await seatTokenDigestHex(token, secret);

  let difference = 0;
  for (let index = 0; index < actualDigestHex.length; index += 1) {
    difference |= actualDigestHex.charCodeAt(index) ^ expectedDigestHex.charCodeAt(index);
  }
  return difference === 0;
}

function frameText(message: string | ArrayBuffer): string {
  let bytes: Uint8Array;
  try {
    if (typeof message === 'string') {
      // 巨大な文字列をもう一度encodeする前に、UTF-16長でも早期拒否する。
      if (message.length > SEAT_AUTH_FRAME_MAX_BYTES) {
        throw new SeatTokenError('SEAT_AUTH_FRAME_TOO_LARGE');
      }
      bytes = textEncoder.encode(message);
    } else if (message instanceof ArrayBuffer) {
      if (message.byteLength > SEAT_AUTH_FRAME_MAX_BYTES) {
        throw new SeatTokenError('SEAT_AUTH_FRAME_TOO_LARGE');
      }
      bytes = new Uint8Array(message);
    } else {
      throw new SeatTokenError('SEAT_AUTH_FRAME_INVALID');
    }
  } catch (error) {
    if (error instanceof SeatTokenError) throw error;
    throw new SeatTokenError('SEAT_AUTH_FRAME_INVALID');
  }

  if (bytes.byteLength === 0) throw new SeatTokenError('SEAT_AUTH_FRAME_INVALID');
  if (bytes.byteLength > SEAT_AUTH_FRAME_MAX_BYTES) {
    throw new SeatTokenError('SEAT_AUTH_FRAME_TOO_LARGE');
  }
  try {
    return textDecoder.decode(bytes);
  } catch {
    throw new SeatTokenError('SEAT_AUTH_FRAME_INVALID');
  }
}

function parseSeatAuthResume(value: unknown): SeatAuthResume {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SeatTokenError('SEAT_AUTH_FRAME_INVALID');
  }

  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== 'lastEventSequence' ||
    keys[1] !== 'projectionVersion' ||
    keys[2] !== 'viewerEventVersion' ||
    candidate.projectionVersion !== MATCH_PLAYER_PROJECTION_VERSION ||
    candidate.viewerEventVersion !== MATCH_VIEWER_EVENT_VERSION ||
    !Number.isSafeInteger(candidate.lastEventSequence) ||
    (candidate.lastEventSequence as number) < 0
  ) {
    throw new SeatTokenError('SEAT_AUTH_FRAME_INVALID');
  }

  return Object.freeze({
    projectionVersion: MATCH_PLAYER_PROJECTION_VERSION,
    viewerEventVersion: MATCH_VIEWER_EVENT_VERSION,
    lastEventSequence: candidate.lastEventSequence as number,
  });
}

/** 最初のWebSocket message専用。旧2-keyとresume付き3-keyだけを受理する。 */
export function parseSeatAuthFrame(message: string | ArrayBuffer): SeatAuthFrame {
  let value: unknown;
  try {
    value = JSON.parse(frameText(message)) as unknown;
  } catch (error) {
    if (error instanceof SeatTokenError) throw error;
    throw new SeatTokenError('SEAT_AUTH_FRAME_INVALID');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SeatTokenError('SEAT_AUTH_FRAME_INVALID');
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const isLegacyFrame = keys.length === 2 && keys[0] === 'seatToken' && keys[1] === 'type';
  const isResumeFrame =
    keys.length === 3 && keys[0] === 'resume' && keys[1] === 'seatToken' && keys[2] === 'type';
  if ((!isLegacyFrame && !isResumeFrame) || candidate.type !== 'auth') {
    throw new SeatTokenError('SEAT_AUTH_FRAME_INVALID');
  }
  try {
    assertSeatToken(candidate.seatToken);
  } catch {
    throw new SeatTokenError('SEAT_AUTH_FRAME_INVALID');
  }

  return Object.freeze({
    type: 'auth',
    seatToken: candidate.seatToken,
    resume: isResumeFrame ? parseSeatAuthResume(candidate.resume) : null,
  });
}
