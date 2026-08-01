import { PROTOCOL_SCAFFOLD } from '@bravers/protocol';
import { handleAuthRequest } from './http/authController';
import { handleMatchAccessRequest } from './http/matchAccessController';
export { MatchDO, matchIdFromPath } from './match/matchDurableObject';
export { SessionCoordinatorDO } from './session/sessionCoordinatorDurableObject';

const HEALTH_MATCH_ID = 'olg-102-health';

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

    const matchResponse = await handleMatchAccessRequest(request, env);
    if (matchResponse) return matchResponse;

    const authResponse = await handleAuthRequest(request, env);
    if (authResponse) return authResponse;

    return json({ error: 'NOT_FOUND' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
