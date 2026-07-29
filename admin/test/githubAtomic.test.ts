import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ghCommitFiles,
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

describe('GitHub原子的複数ファイルcommit', () => {
  it('新規blobと同一リポの既存blob参照を1つのtree/commitへ入れ、最後にrefだけ更新する', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const blobBodies: unknown[] = [];
    let blobNo = 0;
    let treeBody: {
      tree: Array<{ path: string; sha: string | null }>;
    } | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        calls.push({ url, method });
        if (url.endsWith('/repos/RaccBigenner/bravers_duel')) {
          return json({ default_branch: 'main' });
        }
        if (url.endsWith('/git/ref/heads/main')) {
          return json({ object: { sha: 'base-commit' } });
        }
        if (url.endsWith('/git/commits/base-commit')) {
          return json({ tree: { sha: 'base-tree' } });
        }
        if (url.endsWith('/git/trees/base-tree?recursive=1')) {
          return json({
            truncated: false,
            tree: [
              {
                path: 'data/cards.json',
                type: 'blob',
                sha: 'cards-old',
              },
              {
                path: 'data/sets.json',
                type: 'blob',
                sha: 'sets-old',
              },
            ],
          });
        }
        if (url.endsWith('/git/blobs') && method === 'POST') {
          blobBodies.push(JSON.parse(String(init?.body)));
          return json({ sha: `blob-${++blobNo}` });
        }
        if (url.endsWith('/git/trees') && method === 'POST') {
          treeBody = JSON.parse(String(init?.body));
          return json({ sha: 'next-tree' });
        }
        if (url.endsWith('/git/commits') && method === 'POST') {
          return json({ sha: 'next-commit' });
        }
        if (
          url.endsWith('/git/refs/heads/main') &&
          method === 'PATCH'
        ) {
          return json({ object: { sha: 'next-commit' } });
        }
        return json({}, 404);
      }),
    );

    await ghCommitFiles(
      env,
      'bravers_duel',
      [
        {
          path: 'data/cards.json',
          bytes: new TextEncoder().encode('cards'),
        },
        {
          path: 'data/sets.json',
          base64: 'c2V0cw==',
        },
      ],
      'atomic publish',
      {
        'data/cards.json': 'cards-old',
        'data/sets.json': 'sets-old',
        'assets/card_images/2-A001-C.webp': null,
      },
      [
        {
          path: 'assets/card_images/2-A001-C.webp',
          sha: 'existing-image-blob',
        },
      ],
    );

    expect(
      calls.filter(
        (call) =>
          call.url.endsWith('/git/blobs') && call.method === 'POST',
      ),
    ).toHaveLength(2);
    expect(blobBodies[1]).toEqual({
      content: 'c2V0cw==',
      encoding: 'base64',
    });
    expect(treeBody?.tree).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'data/cards.json',
          sha: 'blob-1',
        }),
        expect.objectContaining({
          path: 'data/sets.json',
          sha: 'blob-2',
        }),
        expect.objectContaining({
          path: 'assets/card_images/2-A001-C.webp',
          sha: 'existing-image-blob',
        }),
      ]),
    );
    expect(calls.at(-1)).toEqual({
      method: 'PATCH',
      url: expect.stringMatching(/\/git\/refs\/heads\/main$/),
    });
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
    expect(
      calls.some(
        (call) => call.url === 'https://api.github.com/graphql',
      ),
    ).toBe(false);
  });

  it('baseのJSONが並行更新されていたらblob作成前に停止する', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        calls.push({ url, method });
        if (url.endsWith('/repos/RaccBigenner/bravers_duel')) {
          return json({ default_branch: 'main' });
        }
        if (url.endsWith('/git/ref/heads/main')) {
          return json({ object: { sha: 'base-commit' } });
        }
        if (url.endsWith('/git/commits/base-commit')) {
          return json({ tree: { sha: 'base-tree' } });
        }
        if (url.endsWith('/git/trees/base-tree?recursive=1')) {
          return json({
            truncated: false,
            tree: [
              {
                path: 'data/cards.json',
                type: 'blob',
                sha: 'changed-sha',
              },
            ],
          });
        }
        return json({}, 404);
      }),
    );

    await expect(
      ghCommitFiles(
        env,
        'bravers_duel',
        [
          {
            path: 'data/cards.json',
            bytes: new Uint8Array([1]),
          },
        ],
        'must not publish',
        { 'data/cards.json': 'expected-old-sha' },
      ),
    ).rejects.toThrow('確認中に更新');
    expect(
      calls.some(
        (call) =>
          call.url.endsWith('/git/blobs') && call.method === 'POST',
      ),
    ).toBe(false);
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('tree確認後にbranchが動いた場合もfast-forwardを拒否して409にする', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (url.endsWith('/repos/RaccBigenner/bravers_duel')) {
          return json({ default_branch: 'main' });
        }
        if (url.endsWith('/git/ref/heads/main')) {
          return json({ object: { sha: 'base-commit' } });
        }
        if (url.endsWith('/git/commits/base-commit')) {
          return json({ tree: { sha: 'base-tree' } });
        }
        if (url.endsWith('/git/trees/base-tree?recursive=1')) {
          return json({
            truncated: false,
            tree: [
              {
                path: 'data/cards.json',
                type: 'blob',
                sha: 'cards-old',
              },
            ],
          });
        }
        if (url.endsWith('/git/blobs') && method === 'POST') {
          return json({ sha: 'new-blob' });
        }
        if (url.endsWith('/git/trees') && method === 'POST') {
          return json({ sha: 'next-tree' });
        }
        if (url.endsWith('/git/commits') && method === 'POST') {
          return json({ sha: 'next-commit' });
        }
        if (
          url.endsWith('/git/refs/heads/main') &&
          method === 'PATCH'
        ) {
          return json(
            { message: 'Update is not a fast forward' },
            422,
          );
        }
        return json({}, 404);
      }),
    );

    await expect(
      ghCommitFiles(
        env,
        'bravers_duel',
        [
          {
            path: 'data/cards.json',
            bytes: new Uint8Array([1]),
          },
        ],
        'race-safe publish',
        { 'data/cards.json': 'cards-old' },
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('確認中に更新'),
    });
  });
});
