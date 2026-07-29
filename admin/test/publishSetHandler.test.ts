import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/publish-set';
import type { Env, PublishManifest } from '../functions/_github';

const REQUEST_ID = '15f7ea40-b0c4-4d9b-bc1f-4512bb5dbe37';
const SHA = 'a'.repeat(40);
const env = {
  GITHUB_PRIVATE_TOKEN: 'private-test-token',
  GITHUB_PUBLIC_TOKEN: 'public-test-token',
  CF_ACCESS_TEAM_DOMAIN: 'https://example.invalid',
  CF_ACCESS_AUD: 'test-aud',
} satisfies Env;

const manifest = (vol = 2): PublishManifest => ({
  schemaVersion: 3,
  vol,
  requestId: REQUEST_ID,
  set: {
    vol,
    status: 'publishing',
    publishOperationId: REQUEST_ID,
  },
  cardsSha: SHA,
  effectsSha: SHA,
  effectTestsSha: SHA,
  imageShas: { [`${vol}-A001-C`]: SHA },
  cardCount: 1,
  createdAt: '2026-07-29T00:00:00.000Z',
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function githubFile(data: unknown): Response {
  return json({
    sha: SHA,
    encoding: 'base64',
    content: Buffer.from(JSON.stringify(data), 'utf8').toString('base64'),
  });
}

interface Scenario {
  active?: PublishManifest | null;
  wipSets?: unknown;
  publicSets?: unknown;
  runs?: unknown[];
  dispatchStatus?: number;
}

async function publish(scenario: Scenario): Promise<{
  response: Response;
  calls: Array<{ url: string; method: string }>;
}> {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (url.includes('/bravers_duel_wip/contents/publish_jobs/active.json')) {
        return scenario.active
          ? githubFile(scenario.active)
          : json({}, 404);
      }
      if (url.includes('/bravers_duel_wip/contents/sets.wip.json')) {
        return githubFile(scenario.wipSets ?? { sets: [] });
      }
      if (url.includes('/bravers_duel/contents/data/sets.json')) {
        return githubFile(scenario.publicSets ?? { sets: [] });
      }
      if (url.includes('/bravers_duel_wip/contents/cards/vol2.json')) {
        return githubFile([]);
      }
      if (url.includes('/bravers_duel/contents/data/cards.json')) {
        return githubFile([]);
      }
      if (url.includes('/actions/workflows/publish-set.yml/runs?')) {
        return json({ workflow_runs: scenario.runs ?? [] });
      }
      if (
        url.endsWith('/actions/workflows/publish-set.yml/dispatches') &&
        method === 'POST'
      ) {
        const status = scenario.dispatchStatus ?? 200;
        return status === 200
          ? json({
              workflow_run_id: 42,
              run_url: 'https://api.github.test/runs/42',
              html_url: 'https://github.test/runs/42',
            })
          : new Response(null, { status });
      }
      return json({}, 404);
    }),
  );

  const request = new Request('https://cards.example/api/publish-set', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://cards.example',
      'Sec-Fetch-Site': 'same-origin',
    },
    body: JSON.stringify({ vol: 2 }),
  });
  const response = await onRequestPost({ request, env } as never);
  return { response, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('publish-set既存operationの再開', () => {
  it('同じrequestの待機runがあれば重複dispatchせずそのrunを返す', async () => {
    const active = manifest();
    const { response, calls } = await publish({
      active,
      wipSets: { sets: [active.set] },
      runs: [{
        id: 41,
        display_title: `Publish card set vol2 (${REQUEST_ID})`,
        status: 'in_progress',
        conclusion: null,
        html_url: 'https://github.test/runs/41',
      }],
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: 'queued',
      requestId: REQUEST_ID,
      runId: 41,
    });
    expect(
      calls.filter(({ url, method }) =>
        url.endsWith('/dispatches') && method === 'POST'
      ),
    ).toHaveLength(0);
  });

  it('別volのactive operationがあれば新しいlockやdispatchを作らない', async () => {
    const { response, calls } = await publish({
      active: manifest(3),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('第3弾の公開処理'),
    });
    expect(calls.some(({ url }) => url.includes('/actions/'))).toBe(false);
  });

  it('manifestとWIP lockが不一致なら推測で再開しない', async () => {
    const active = manifest();
    const { response, calls } = await publish({
      active,
      wipSets: { sets: [{ ...active.set, publishOperationId: 'other' }] },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('ロックと管理ファイルが一致しません'),
    });
    expect(calls.some(({ url }) => url.includes('/actions/'))).toBe(false);
  });

  it('公開済みでWIPが無ければ新operationを作らずcompleteを返す', async () => {
    const { response, calls } = await publish({
      active: null,
      publicSets: { sets: [{ vol: 2, status: 'released' }] },
      wipSets: { sets: [] },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      status: 'complete',
      alreadyReleased: true,
      cardCount: 0,
    });
    expect(calls.some(({ url }) => url.includes('/actions/'))).toBe(false);
  });

  it('dispatch応答が旧204ならrun ID不明の成功扱いをせず502にする', async () => {
    const active = manifest();
    const { response, calls } = await publish({
      active,
      wipSets: { sets: [active.set] },
      dispatchStatus: 204,
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('(204)'),
    });
    expect(
      calls.filter(({ url, method }) =>
        url.endsWith('/dispatches') && method === 'POST'
      ),
    ).toHaveLength(1);
  });
});
