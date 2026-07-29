import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet } from '../functions/api/publish-status';
import type { Env, PublishManifest } from '../functions/_github';

const REQUEST_ID = '15f7ea40-b0c4-4d9b-bc1f-4512bb5dbe37';
const OTHER_REQUEST_ID = 'f2d25e2f-b93a-4488-bec7-1fc11ea42ad4';
const SHA = 'a'.repeat(40);
const env = {
  GITHUB_PRIVATE_TOKEN: 'private-test-token',
  GITHUB_PUBLIC_TOKEN: 'public-test-token',
  CF_ACCESS_TEAM_DOMAIN: 'https://example.invalid',
  CF_ACCESS_AUD: 'test-aud',
} satisfies Env;

const active = (vol = 2, requestId = REQUEST_ID): PublishManifest => ({
  schemaVersion: 3,
  vol,
  requestId,
  set: {
    vol,
    status: 'publishing',
    publishOperationId: requestId,
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
  publicSets?: unknown;
  wipSets?: unknown;
  active?: PublishManifest | null;
  requestedRun?: {
    id: number;
    status: string;
    conclusion: string | null;
    html_url: string;
  };
  latestRuns?: unknown[];
}

async function requestStatus(scenario: Scenario): Promise<{
  response: Response;
  calls: string[];
}> {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/bravers_duel/contents/data/sets.json')) {
        return githubFile(scenario.publicSets ?? { sets: [] });
      }
      if (url.includes('/bravers_duel_wip/contents/sets.wip.json')) {
        return githubFile(scenario.wipSets ?? { sets: [] });
      }
      if (url.includes('/bravers_duel_wip/contents/publish_jobs/active.json')) {
        return scenario.active
          ? githubFile(scenario.active)
          : json({}, 404);
      }
      if (url.includes('/bravers_duel_wip/actions/runs/')) {
        return json(
          scenario.requestedRun ?? {
            id: 40,
            status: 'completed',
            conclusion: 'failure',
            html_url: 'https://github.test/runs/40',
          },
        );
      }
      if (url.includes('/actions/workflows/publish-set.yml/runs?')) {
        return json({ workflow_runs: scenario.latestRuns ?? [] });
      }
      return json({}, 404);
    }),
  );

  const request = new Request(
    `https://cards.example/api/publish-status?vol=2&runId=40&requestId=${REQUEST_ID}`,
  );
  const response = await onRequestGet({ request, env } as never);
  return { response, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('publish-status状態遷移', () => {
  it('別volの新operationが始まった後でも、公開済みの古いpollはcompleteになる', async () => {
    const { response, calls } = await requestStatus({
      publicSets: { sets: [{ vol: 2, status: 'released' }] },
      wipSets: { sets: [] },
      active: active(3, OTHER_REQUEST_ID),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'complete',
      retryable: false,
    });
    expect(calls.some((url) => url.includes('/actions/runs/'))).toBe(false);
  });

  it('同じvolでも別requestのactiveなら古いpollを409で止める', async () => {
    const { response, calls } = await requestStatus({
      active: active(2, OTHER_REQUEST_ID),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('別の公開処理'),
    });
    expect(calls.some((url) => url.includes('/actions/runs/'))).toBe(false);
  });

  it('公開済みでActions成功・WIP lockありならcleanup再開を促す', async () => {
    const { response } = await requestStatus({
      publicSets: { sets: [{ vol: 2, status: 'released' }] },
      wipSets: {
        sets: [{
          vol: 2,
          status: 'publishing',
          publishOperationId: REQUEST_ID,
        }],
      },
      active: active(),
      requestedRun: {
        id: 40,
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.test/runs/40',
      },
    });

    await expect(response.json()).resolves.toMatchObject({
      status: 'cleanup_pending',
      retryable: true,
    });
  });

  it('失敗後にactiveとpublishing lockが消えていれば編集可能なfailed_unlocked', async () => {
    const { response } = await requestStatus({
      wipSets: { sets: [{ vol: 2, status: 'draft' }] },
      active: null,
    });

    await expect(response.json()).resolves.toMatchObject({
      status: 'failed_unlocked',
      retryable: true,
    });
  });

  it('失敗後もactive lockがあれば安全な再実行用failed_retryable', async () => {
    const { response } = await requestStatus({
      wipSets: {
        sets: [{
          vol: 2,
          status: 'publishing',
          publishOperationId: REQUEST_ID,
        }],
      },
      active: active(),
    });

    await expect(response.json()).resolves.toMatchObject({
      status: 'failed_retryable',
      retryable: true,
    });
  });

  it('重複dispatchでは古い失敗runより新しい待機runを優先する', async () => {
    const { response } = await requestStatus({
      wipSets: {
        sets: [{
          vol: 2,
          status: 'publishing',
          publishOperationId: REQUEST_ID,
        }],
      },
      active: active(),
      requestedRun: {
        id: 40,
        status: 'completed',
        conclusion: 'cancelled',
        html_url: 'https://github.test/runs/40',
      },
      latestRuns: [{
        id: 41,
        display_title: `Publish card set vol2 (${REQUEST_ID})`,
        status: 'queued',
        conclusion: null,
        html_url: 'https://github.test/runs/41',
      }],
    });

    await expect(response.json()).resolves.toMatchObject({
      status: 'queued',
      retryable: false,
      runUrl: 'https://github.test/runs/41',
    });
  });
});
