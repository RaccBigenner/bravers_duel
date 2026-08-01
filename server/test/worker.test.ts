import { env, exports as workerExports } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { MatchDO, SERVER_FOUNDATION, matchIdFromPath } from '../src/index';

function nextMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      cleanup();
      resolve(String(event.data));
    };
    const onError = () => {
      cleanup();
      reject(new Error('WebSocket probe failed'));
    };
    const cleanup = () => {
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('error', onError);
    };
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);
  });
}

describe('@bravers/server OLG-102 foundation', () => {
  it('workspaceの入口を実行可能にしつつゲームprotocolは先行確定しない', () => {
    expect(SERVER_FOUNDATION).toEqual({
      packageName: '@bravers/server',
      protocolVersion: 'OLG-101',
      operational: true,
      gameProtocolOperational: false,
    });
  });

  it('match WebSocket pathを安全なIDだけに限定する', () => {
    expect(matchIdFromPath('/matches/local-smoke_1/ws')).toBe('local-smoke_1');
    expect(matchIdFromPath('/matches/../ws')).toBeNull();
    expect(matchIdFromPath('/matches/%2F/ws')).toBeNull();
    expect(matchIdFromPath('/matches/a/ws/extra')).toBeNull();
  });

  it('health APIがWorker・MatchDO・DO SQLiteの疎通を返す', async () => {
    const response = await workerExports.default.fetch('http://local.test/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      status: 'ok',
      service: '@bravers/server',
      environment: 'local',
      runId: null,
      checks: {
        worker: true,
        durableObject: true,
        durableObjectSqlite: true,
      },
    });
  });

  it('未知routeとUpgradeなしを明示的に拒否する', async () => {
    const missing = await workerExports.default.fetch('http://local.test/no-such-route');
    const rejectedGuest = await workerExports.default.fetch(
      'http://local.test/auth/guest',
      { method: 'POST', body: '{}' },
    );
    const noUpgrade = await workerExports.default.fetch(
      'http://local.test/matches/local-smoke/ws',
    );
    const noSession = await workerExports.default.fetch(
      'http://127.0.0.1:8787/auth/session',
      {
        headers: {
          'Sec-Fetch-Site': 'same-origin',
          'X-Bravers-Duel-Client': 'web-v1',
        },
      },
    );

    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'NOT_FOUND' });
    expect(rejectedGuest.status).toBe(403);
    expect(await rejectedGuest.json()).toEqual({ error: 'AUTH_REQUEST_REJECTED' });
    expect(noUpgrade.status).toBe(426);
    expect(await noUpgrade.json()).toEqual({ error: 'WEBSOCKET_UPGRADE_REQUIRED' });
    expect(noSession.status).toBe(401);
    expect(noSession.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await noSession.json()).toEqual({ error: 'SESSION_REQUIRED' });
  });

  it('MatchDOの最小WebSocket probeが休止復帰後も往復する', async () => {
    const matchId = 'local-smoke';
    const response = await workerExports.default.fetch(
      `http://local.test/matches/${matchId}/ws`,
      { headers: { Upgrade: 'websocket' } },
    );
    const socket = response.webSocket;
    if (!socket) throw new Error('Expected WebSocket response');
    socket.accept();

    const first = nextMessage(socket);
    socket.send('probe:first');
    expect(await first).toBe('probe_ack:local-smoke:first');

    const id = env.MATCH_DO.idFromName(matchId);
    const stub = env.MATCH_DO.get(id);
    await runInDurableObject(stub, async (instance, state) => {
      expect(instance).toBeInstanceOf(MatchDO);
      expect(state.storage.sql.exec<{ ok: number }>('SELECT 1 AS ok').one().ok).toBe(1);
    });
    await evictDurableObject(stub);

    const afterEviction = nextMessage(socket);
    socket.send('probe:after-eviction');
    expect(await afterEviction).toBe('probe_ack:local-smoke:after-eviction');
    socket.close(1000, 'done');
  });
});
