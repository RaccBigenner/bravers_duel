import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ghDispatchWorkflow,
  ghFindWorkflowRun,
  ghGetWorkflowRun,
  ghListDir,
  type Env,
} from '../functions/_github';

const env = {
  GITHUB_PRIVATE_TOKEN: 'private-test-token',
  GITHUB_PUBLIC_TOKEN: 'public-test-token',
  CF_ACCESS_TEAM_DOMAIN: 'https://example.invalid',
  CF_ACCESS_AUD: 'test-aud',
} satisfies Env;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GitHub Actions公開連携', () => {
  it('2026 APIで非公開workflowを起動しrun IDを受け取る', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        request = { url: String(input), init };
        return json({
          workflow_run_id: 42,
          run_url: 'https://api.github.test/runs/42',
          html_url: 'https://github.test/actions/runs/42',
        });
      }),
    );

    const result = await ghDispatchWorkflow(
      env,
      'bravers_duel_wip',
      'publish-set.yml',
      { vol: '2', request_id: 'request-id' },
    );

    expect(result.workflowRunId).toBe(42);
    expect(request?.url).toMatch(
      /bravers_duel_wip\/actions\/workflows\/publish-set\.yml\/dispatches$/,
    );
    expect(request?.init?.headers).toMatchObject({
      'X-GitHub-Api-Version': '2026-03-10',
      Authorization: 'Bearer private-test-token',
    });
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      ref: 'main',
      inputs: { vol: '2', request_id: 'request-id' },
      return_run_details: true,
    });
  });

  it('workflowログ本文を取らず状態と非公開run URLだけを返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          id: 42,
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://github.test/actions/runs/42',
          logs_url: 'https://api.github.test/private-log',
        }),
      ),
    );

    await expect(
      ghGetWorkflowRun(env, 'bravers_duel_wip', 42),
    ).resolves.toEqual({
      id: 42,
      status: 'completed',
      conclusion: 'success',
      htmlUrl: 'https://github.test/actions/runs/42',
    });
  });

  it('同じrequest titleの最新workflow runを選ぶ', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          workflow_runs: [
            {
              id: 10,
              display_title: 'other',
              status: 'completed',
              conclusion: 'success',
              html_url: 'https://github.test/10',
            },
            {
              id: 12,
              display_title: 'Publish card set vol2 (request)',
              status: 'in_progress',
              conclusion: null,
              html_url: 'https://github.test/12',
            },
            {
              id: 11,
              display_title: 'Publish card set vol2 (request)',
              status: 'completed',
              conclusion: 'cancelled',
              html_url: 'https://github.test/11',
            },
          ],
        }),
      ),
    );

    await expect(
      ghFindWorkflowRun(
        env,
        'bravers_duel_wip',
        'publish-set.yml',
        'Publish card set vol2 (request)',
      ),
    ).resolves.toMatchObject({ id: 12, status: 'in_progress' });
  });

  it('run detailsの無い旧204応答を成功扱いしない', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(
      ghDispatchWorkflow(
        env,
        'bravers_duel_wip',
        'publish-set.yml',
        { vol: '2', request_id: 'request-id' },
      ),
    ).rejects.toMatchObject({ status: 204 });
  });
});

describe('Git Treesによるディレクトリ一覧', () => {
  it('Contents APIの1000件上限を使わず1001画像を列挙する', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('/repos/RaccBigenner/bravers_duel')) {
          return json({ default_branch: 'main' });
        }
        if (url.endsWith('/git/trees/main')) {
          return json({
            truncated: false,
            tree: [{ path: 'assets', type: 'tree', sha: 'assets-tree' }],
          });
        }
        if (url.endsWith('/git/trees/assets-tree')) {
          return json({
            truncated: false,
            tree: [
              {
                path: 'card_images',
                type: 'tree',
                sha: 'images-tree',
              },
            ],
          });
        }
        if (url.endsWith('/git/trees/images-tree')) {
          return json({
            truncated: false,
            tree: Array.from({ length: 1001 }, (_, index) => ({
              path: `${index}.webp`,
              type: 'blob',
              sha: `sha-${index}`,
            })),
          });
        }
        return json({}, 404);
      }),
    );

    const images = await ghListDir(
      env,
      'bravers_duel',
      'assets/card_images',
    );

    expect(Object.keys(images)).toHaveLength(1001);
    expect(images['1000.webp']).toBe('sha-1000');
    expect(calls.some((url) => url.includes('/contents/'))).toBe(false);
  });
});
