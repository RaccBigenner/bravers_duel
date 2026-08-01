import {
  parseActiveMatchResponse,
  parseMatchResultResponse,
  parseMatchSeatTokenResponse,
  type ActiveMatchResponse,
  type MatchId,
  type MatchResultResponse,
  type MatchSeatTokenResponse,
} from '@bravers/protocol';

export const ONLINE_CLIENT_HEADER = 'X-Bravers-Duel-Client';
export const ONLINE_CLIENT_HEADER_VALUE = 'web-v1';
const MAX_RECOVERY_RESPONSE_BYTES = 64 * 1024;

export type MatchTransportErrorKind =
  | 'session'
  | 'missing'
  | 'rate_limited'
  | 'temporary'
  | 'protocol';

export class MatchTransportError extends Error {
  constructor(
    public readonly kind: MatchTransportErrorKind,
    public readonly status: number | null = null,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(`MATCH_TRANSPORT_${kind.toUpperCase()}`);
    this.name = 'MatchTransportError';
  }
}

export interface MatchSocketLike {
  binaryType: BinaryType;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface MatchTransportDependencies {
  fetch: FetchLike;
  createSocket(url: string): MatchSocketLike;
  location: Pick<Location, 'protocol' | 'host'>;
  now(): number;
}

function requestHeaders(json = false): Headers {
  const headers = new Headers({ [ONLINE_CLIENT_HEADER]: ONLINE_CLIENT_HEADER_VALUE });
  if (json) headers.set('Content-Type', 'application/json');
  return headers;
}

function classifyResponse(response: Response): never {
  const status = response.status;
  if (status === 401) throw new MatchTransportError('session', status);
  if (status === 404 || status === 409) throw new MatchTransportError('missing', status);
  if (status === 429) {
    const seconds = Number(response.headers.get('Retry-After'));
    throw new MatchTransportError(
      'rate_limited',
      status,
      Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1_000, 30_000) : 1_000,
    );
  }
  if (status === 502 || status === 503 || status === 504) {
    throw new MatchTransportError('temporary', status);
  }
  throw new MatchTransportError('protocol', status);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RECOVERY_RESPONSE_BYTES)) {
    throw new MatchTransportError('protocol', response.status);
  }
  if (!response.body) throw new MatchTransportError('protocol', response.status);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RECOVERY_RESPONSE_BYTES) {
        await reader.cancel();
        throw new MatchTransportError('protocol', response.status);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof MatchTransportError) throw error;
    throw new MatchTransportError('temporary', response.status);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new MatchTransportError('protocol', response.status);
  }
}

function safeFetchError(error: unknown): never {
  if (error instanceof MatchTransportError) throw error;
  throw new MatchTransportError('temporary');
}

export class BrowserMatchTransport {
  constructor(private readonly dependencies: MatchTransportDependencies) {}

  async activeMatch(signal: AbortSignal): Promise<ActiveMatchResponse> {
    let response: Response;
    try {
      response = await this.dependencies.fetch('/me/active-match', {
        method: 'GET',
        headers: requestHeaders(),
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal,
      });
    } catch (error) {
      safeFetchError(error);
    }
    if (response.status !== 200) classifyResponse(response);
    const parsed = parseActiveMatchResponse(await readBoundedJson(response));
    if (!parsed) throw new MatchTransportError('protocol', response.status);
    return parsed;
  }

  async issueSeatToken(matchId: MatchId, signal: AbortSignal): Promise<MatchSeatTokenResponse> {
    let response: Response;
    try {
      response = await this.dependencies.fetch(`/matches/${encodeURIComponent(matchId)}/seat-token`, {
        method: 'POST',
        headers: requestHeaders(true),
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        body: '{}',
        signal,
      });
    } catch (error) {
      safeFetchError(error);
    }
    if (response.status !== 201) classifyResponse(response);
    const parsed = parseMatchSeatTokenResponse(await readBoundedJson(response));
    if (!parsed || Date.parse(parsed.expiresAt) <= this.dependencies.now()) {
      throw new MatchTransportError('protocol', response.status);
    }
    return parsed;
  }

  async matchResult(matchId: MatchId, signal: AbortSignal): Promise<MatchResultResponse> {
    let response: Response;
    try {
      response = await this.dependencies.fetch(`/matches/${encodeURIComponent(matchId)}/result`, {
        method: 'GET',
        headers: requestHeaders(),
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal,
      });
    } catch (error) {
      safeFetchError(error);
    }
    if (response.status !== 200) classifyResponse(response);
    const parsed = parseMatchResultResponse(await readBoundedJson(response));
    if (!parsed || parsed.matchId !== matchId) {
      throw new MatchTransportError('protocol', response.status);
    }
    return parsed;
  }

  createSocket(matchId: MatchId): MatchSocketLike {
    const { protocol, host } = this.dependencies.location;
    if ((protocol !== 'http:' && protocol !== 'https:') || host.length === 0) {
      throw new MatchTransportError('protocol');
    }
    const socketProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
    return this.dependencies.createSocket(
      `${socketProtocol}//${host}/matches/${encodeURIComponent(matchId)}/ws`,
    );
  }
}

export function createBrowserMatchTransport(): BrowserMatchTransport {
  return new BrowserMatchTransport({
    fetch: window.fetch.bind(window),
    createSocket: (url) => new WebSocket(url),
    location: window.location,
    now: () => Date.now(),
  });
}
