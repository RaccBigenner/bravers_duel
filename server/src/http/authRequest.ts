export const AUTH_CLIENT_HEADER = 'X-Bravers-Duel-Client';
export const AUTH_CLIENT_HEADER_VALUE = 'web-v1';
export const MAX_AUTH_BODY_BYTES = 4096;

export type AuthRequestErrorCode =
  | 'AUTH_REQUEST_REJECTED'
  | 'AUTH_BODY_INVALID'
  | 'AUTH_BODY_TOO_LARGE';

export class AuthRequestError extends Error {
  constructor(
    public readonly code: AuthRequestErrorCode,
    public readonly status: 400 | 403 | 413,
  ) {
    super(code);
    this.name = 'AuthRequestError';
  }
}

function rejectRequest(): never {
  throw new AuthRequestError('AUTH_REQUEST_REJECTED', 403);
}

function requestTarget(request: Request, appOrigin: string): URL {
  let target: URL;
  try {
    target = new URL(request.url);
  } catch {
    rejectRequest();
  }
  if (
    target.origin !== appOrigin ||
    target.username !== '' ||
    target.password !== '' ||
    target.search !== '' ||
    request.headers.get('Sec-Fetch-Site') !== 'same-origin' ||
    request.headers.get(AUTH_CLIENT_HEADER) !== AUTH_CLIENT_HEADER_VALUE
  ) {
    rejectRequest();
  }
  return target;
}

export function validateUnsafeAuthRequest(request: Request, appOrigin: string): void {
  requestTarget(request, appOrigin);
  if (
    request.method !== 'POST' ||
    request.headers.get('Origin') !== appOrigin ||
    request.headers.get('Content-Type')?.toLowerCase() !== 'application/json'
  ) {
    rejectRequest();
  }
}

/** GETは通常Originを送らないため、same-origin Fetch Metadataと固定headerで守る。 */
export function validateSafeAuthRequest(request: Request, appOrigin: string): void {
  requestTarget(request, appOrigin);
  if (request.method !== 'GET') rejectRequest();
}

/** Browser WebSocketはcustom headerを設定できないため、exact Originを必須にする。 */
export function validateWebSocketAuthRequest(
  request: Request,
  appOrigin: string,
): void {
  let target: URL;
  try {
    target = new URL(request.url);
  } catch {
    rejectRequest();
  }
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (
    target.origin !== appOrigin ||
    target.username !== '' ||
    target.password !== '' ||
    target.search !== '' ||
    request.method !== 'GET' ||
    request.headers.get('Origin') !== appOrigin ||
    (fetchSite !== null && fetchSite !== 'same-origin') ||
    request.headers.get('Upgrade')?.toLowerCase() !== 'websocket'
  ) {
    rejectRequest();
  }
}

async function boundedBodyBytes(request: Request): Promise<Uint8Array> {
  const declaredLength = request.headers.get('Content-Length');
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]{0,4})$/.test(declaredLength) ||
      Number(declaredLength) > MAX_AUTH_BODY_BYTES)
  ) {
    throw new AuthRequestError('AUTH_BODY_TOO_LARGE', 413);
  }
  if (!request.body) throw new AuthRequestError('AUTH_BODY_INVALID', 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_AUTH_BODY_BYTES) {
        await reader.cancel();
        throw new AuthRequestError('AUTH_BODY_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AuthRequestError) throw error;
    throw new AuthRequestError('AUTH_BODY_INVALID', 400);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function readAuthJsonObject(request: Request): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await boundedBodyBytes(request));
  } catch (error) {
    if (error instanceof AuthRequestError) throw error;
    throw new AuthRequestError('AUTH_BODY_INVALID', 400);
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new AuthRequestError('AUTH_BODY_INVALID', 400);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AuthRequestError('AUTH_BODY_INVALID', 400);
  }
  return value as Record<string, unknown>;
}

export function hasOnlyObjectKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}
