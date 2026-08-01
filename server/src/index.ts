import { DurableObject } from 'cloudflare:workers';
import { PROTOCOL_SCAFFOLD } from '@bravers/protocol';

const HEALTH_MATCH_ID = 'olg-102-health';
const MATCH_PATH = /^\/matches\/([A-Za-z0-9_-]{1,64})\/ws$/;
const PROBE_PREFIX = 'probe:';

interface ConnectionAttachment {
  matchId: string;
}

export const SERVER_FOUNDATION = {
  packageName: '@bravers/server',
  protocolVersion: PROTOCOL_SCAFFOLD.version,
  operational: true,
  gameProtocolOperational: false,
} as const;

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function matchIdFromPath(pathname: string): string | null {
  return pathname.match(MATCH_PATH)?.[1] ?? null;
}

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
}

/**
 * OLG-102ではDO/SQLite/WebSocketの実行基盤だけを検証する。
 * 試合状態・Command/Event/SnapshotはOLG-121/122/125で追加する。
 */
export class MatchDO extends DurableObject<Env> {
  async sqliteReady(): Promise<boolean> {
    return this.ctx.storage.sql.exec<{ ok: number }>('SELECT 1 AS ok').one().ok === 1;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: { Allow: 'GET' } });
    }
    if (!isWebSocketUpgrade(request)) {
      return json({ error: 'WEBSOCKET_UPGRADE_REQUIRED' }, { status: 426 });
    }

    const matchId = matchIdFromPath(new URL(request.url).pathname);
    if (!matchId) {
      return json({ error: 'INVALID_MATCH_PATH' }, { status: 400 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ matchId } satisfies ConnectionAttachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string') {
      socket.send('error:binary-not-supported');
      return;
    }
    if (!message.startsWith(PROBE_PREFIX)) {
      socket.send('error:probe-only');
      return;
    }

    const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
    const matchId = attachment?.matchId ?? 'unknown';
    socket.send(`probe_ack:${matchId}:${message.slice(PROBE_PREFIX.length)}`);
  }
}

async function health(env: Env): Promise<Response> {
  try {
    const runtimeEnv = env as Env & { OLG102_RUN_ID?: string };
    const id = env.MATCH_DO.idFromName(HEALTH_MATCH_ID);
    const durableObjectSqlite = await env.MATCH_DO.get(id).sqliteReady();
    return json({
      status: 'ok',
      service: '@bravers/server',
      environment: env.APP_ENV,
      runId: runtimeEnv.OLG102_RUN_ID ?? null,
      checks: {
        worker: true,
        durableObject: true,
        durableObjectSqlite,
      },
    });
  } catch {
    return json({ status: 'error', service: '@bravers/server' }, { status: 503 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return health(env);
    }

    const matchId = matchIdFromPath(url.pathname);
    if (matchId) {
      const id = env.MATCH_DO.idFromName(matchId);
      return env.MATCH_DO.get(id).fetch(request);
    }

    return json({ error: 'NOT_FOUND' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
