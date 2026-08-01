import {
  parseMatchCommandClientFrame,
  parseMatchServerFrame,
  type MatchCommandClientFrame,
  type MatchServerFrame,
} from '@bravers/protocol';

/** canonical command 4KiBより先に、空白やmulti-byte文字を含むraw frameを止める。 */
export const MAX_MATCH_CLIENT_FRAME_BYTES = 16 * 1024;
export const MAX_MATCH_SERVER_FRAME_BYTES = 128 * 1024;

export type MatchWireFrameErrorCode =
  | 'MATCH_FRAME_TOO_LARGE'
  | 'MATCH_FRAME_INVALID'
  | 'MATCH_FRAME_OUTPUT_INVALID'
  | 'MATCH_FRAME_OUTPUT_TOO_LARGE';

export class MatchWireFrameError extends Error {
  constructor(public readonly code: MatchWireFrameErrorCode) {
    super(code);
    this.name = 'MatchWireFrameError';
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function matchFrameText(message: string | ArrayBuffer): string {
  let bytes: Uint8Array;
  try {
    if (typeof message === 'string') {
      // UTF-8 byte数はUTF-16 code unit数未満にならないため、安全な早期gateになる。
      if (message.length > MAX_MATCH_CLIENT_FRAME_BYTES) {
        throw new MatchWireFrameError('MATCH_FRAME_TOO_LARGE');
      }
      bytes = textEncoder.encode(message);
    } else if (message instanceof ArrayBuffer) {
      if (message.byteLength > MAX_MATCH_CLIENT_FRAME_BYTES) {
        throw new MatchWireFrameError('MATCH_FRAME_TOO_LARGE');
      }
      bytes = new Uint8Array(message);
    } else {
      throw new MatchWireFrameError('MATCH_FRAME_INVALID');
    }
  } catch (error) {
    if (error instanceof MatchWireFrameError) throw error;
    throw new MatchWireFrameError('MATCH_FRAME_INVALID');
  }
  if (bytes.byteLength === 0) throw new MatchWireFrameError('MATCH_FRAME_INVALID');
  if (bytes.byteLength > MAX_MATCH_CLIENT_FRAME_BYTES) {
    throw new MatchWireFrameError('MATCH_FRAME_TOO_LARGE');
  }
  try {
    return textDecoder.decode(bytes);
  } catch {
    throw new MatchWireFrameError('MATCH_FRAME_INVALID');
  }
}

/** JSON.parse前のraw UTF-8 gateと、action schema前のcandidate exact decodeを分ける。 */
export function parseMatchCommandWebSocketFrame(
  message: string | ArrayBuffer,
): MatchCommandClientFrame {
  let value: unknown;
  try {
    value = JSON.parse(matchFrameText(message)) as unknown;
  } catch (error) {
    if (error instanceof MatchWireFrameError) throw error;
    throw new MatchWireFrameError('MATCH_FRAME_INVALID');
  }
  const frame = parseMatchCommandClientFrame(value);
  if (!frame) throw new MatchWireFrameError('MATCH_FRAME_INVALID');
  return frame;
}

/** server側の生成物もexact decoderを通し、巨大projectionをsocketへ積まない。 */
export function serializeMatchServerFrame(frame: MatchServerFrame): string {
  const decoded = parseMatchServerFrame(frame);
  if (!decoded) throw new MatchWireFrameError('MATCH_FRAME_OUTPUT_INVALID');
  const encoded = JSON.stringify(decoded);
  if (textEncoder.encode(encoded).byteLength > MAX_MATCH_SERVER_FRAME_BYTES) {
    throw new MatchWireFrameError('MATCH_FRAME_OUTPUT_TOO_LARGE');
  }
  return encoded;
}
