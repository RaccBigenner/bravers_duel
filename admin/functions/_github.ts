/**
 * GitHub 連携の共通処理（Cloudflare Pages Functions / Workers 環境）。
 *
 * - 先頭が `_` のファイルは Pages のファイルルーティング対象外なので、
 *   各エンドポイントから import して使うヘルパー置き場に使える。
 * - GitHub REST / GraphQL API を `fetch` で直接叩く（octokit は使わない）。
 * - 日本語を含む JSON を扱うため、base64 は必ず UTF-8 対応で行う
 *   （`atob`/`btoa` は Latin-1 なので TextEncoder/TextDecoder と組み合わせる）。
 * - トークンは公開read-only / 非公開write+Actionsへ分離し、Authorizationヘッダにだけ使う。
 *   レスポンスやエラーメッセージには絶対に含めない。
 */
import {
  CardIdentityError,
  canonicalCardForWrite,
  canonicalCardsForWrite,
  duplicateOracleGameplayDrifts,
  normalizeCardIdentity,
  provisionalOraclePrintingIds,
  type LooseCardRecord,
} from '../shared/cardIdentity';
import { mutationRequestProblem } from '../shared/requestSecurity';

/**
 * Pages Functions のバインディング。
 * PRIVATE tokenは非公開リポのContents read/write + Actions read/write、
 * PUBLIC tokenは公開リポのContents readだけを持つfine-grained PAT。
 */
export interface Env {
  GITHUB_PRIVATE_TOKEN: string;
  GITHUB_PUBLIC_TOKEN: string;
  /** Cloudflare Access のチーム(認証)ドメイン。例: https://xxxx.cloudflareaccess.com */
  CF_ACCESS_TEAM_DOMAIN: string;
  /** Access アプリケーションの Audience(AUD) タグ */
  CF_ACCESS_AUD: string;
}

/** 保存形式のカード（type ごとにフィールドが違うので緩めに持つ） */
export interface MasterCard {
  oracleId: string;
  oracleIdProvisional?: true;
  printingId: string;
  vol: number;
  status?: string;
  [k: string]: unknown;
}

/** 弾（セット）のメタ情報 */
export interface MasterSet {
  vol: number;
  status?: string;
  [k: string]: unknown;
}

/** data/sets.json のトップレベル（_comment などの付随フィールドを保つため index 署名つき） */
export interface SetsFile {
  sets: MasterSet[];
  [k: string]: unknown;
}

export interface PublishManifest {
  schemaVersion: 3;
  vol: number;
  requestId: string;
  set: MasterSet;
  cardsSha: string;
  effectsSha: string;
  effectTestsSha: string;
  imageShas: Record<string, string>;
  cardCount: number;
  createdAt: string;
}

// ---- リポジトリ / パス定数 -------------------------------------------------

/** 公開・非公開いずれも同じオーナー配下 */
export const OWNER = 'RaccBigenner';
/** 公開リポ（public） */
export const PUBLIC_REPO = 'bravers_duel';
/** 非公開リポ（private） */
export const PRIVATE_REPO = 'bravers_duel_wip';

export const SETS_PATH = 'data/sets.json';
export const CARDS_PATH = 'data/cards.json';

/** 公開リポのカード画像ディレクトリ */
export const PUBLIC_IMAGE_DIR = 'assets/card_images';
/** 非公開リポのカード画像ディレクトリ */
export const PRIVATE_IMAGE_DIR = 'images';
/** 公開リポのカード画像パス */
export const publicImagePath = (printingId: string): string =>
  `${PUBLIC_IMAGE_DIR}/${printingId}.webp`;
/** 非公開リポのカード画像パス */
export const privateImagePath = (printingId: string): string =>
  `${PRIVATE_IMAGE_DIR}/${printingId}.webp`;
/** 非公開リポの制作中カードのディレクトリ */
export const WIP_CARDS_DIR = 'cards';
/** 非公開リポの制作中カード配列パス */
export const wipCardsPath = (vol: number): string => `${WIP_CARDS_DIR}/vol${vol}.json`;
/** 新弾と同じcommitで公開するOracle効果module。 */
export const WIP_EFFECTS_DIR = 'effects';
export const wipEffectsPath = (vol: number): string =>
  `${WIP_EFFECTS_DIR}/vol${vol}.ts`;
/** 新弾の効果moduleと同じsnapshot・commitで公開する回帰テスト。 */
export const wipEffectTestsPath = (vol: number): string =>
  `${WIP_EFFECTS_DIR}/vol${vol}.test.ts`;
/**
 * 非公開リポの「制作中の弾メタ」パス。
 * 公開リポの data/sets.json は丸ごとブラウザに配信されるので、未公開の弾の
 * テーマ名・サブタイトルを書くと必ず外から読める（実際に第2弾のサブタイトルが漏れていた）。
 * カードと同じく、制作中の弾メタは非公開リポだけに置く。
 */
export const WIP_SETS_PATH = 'sets.wip.json';
/** GitHub Actionsへ引き渡した公開処理の排他・スナップショット */
export const PUBLISH_ACTIVE_PATH = 'publish_jobs/active.json';
/** 非公開リポのdefault branchに設置する公開workflow */
export const PUBLISH_WORKFLOW = 'publish-set.yml';

// ---- エラー型 --------------------------------------------------------------

/** 入力不正など、クライアントにそのまま返してよいエラー */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 旧idしかないWIPを、読み取り時だけ新しい正規形へそろえる。 */
export function normalizeMasterCard(raw: LooseCardRecord): MasterCard {
  return normalizeCardIdentity(raw) as MasterCard;
}

export function normalizeMasterCards(raws: readonly LooseCardRecord[]): MasterCard[] {
  return raws.map(normalizeMasterCard);
}

/** APIから受ける保存データは両ID必須。旧idだけのwriteは受理しない。 */
export function requireCanonicalMasterCard(raw: LooseCardRecord): MasterCard {
  try {
    return canonicalCardForWrite(raw) as MasterCard;
  } catch (error) {
    if (error instanceof CardIdentityError) throw new HttpError(400, error.message);
    throw error;
  }
}

/** 書き戻す配列全体を正規化し、printingIdの重複も最後に止める。 */
export function requireCanonicalMasterCards(raws: readonly LooseCardRecord[]): MasterCard[] {
  try {
    return canonicalCardsForWrite(raws) as MasterCard[];
  } catch (error) {
    if (error instanceof CardIdentityError) throw new HttpError(400, error.message);
    throw error;
  }
}

/** 公開データを書き換える直前に、同一oracleのゲーム定義driftを止める。 */
export function requireNoOracleGameplayDrifts(cards: readonly MasterCard[]): void {
  const drifts = duplicateOracleGameplayDrifts(cards);
  if (drifts.length === 0) return;
  const detail = drifts
    .map((drift) => `${drift.oracleId} (${drift.printingIds.join(' / ')})`)
    .join('、');
  throw new HttpError(400, `同じoracleIdのゲーム定義が一致しません: ${detail}`);
}

/** 旧id由来の仮Oracleを、利用者が明示決定しないまま公開させない。 */
export function requireResolvedOracleIds(cards: readonly MasterCard[]): void {
  const provisional = provisionalOraclePrintingIds(cards);
  if (provisional.length === 0) return;
  throw new HttpError(
    400,
    `旧形式の仮Oracleが残っています: ${provisional.join('、')}。再録元を指定するか、新規Oracleを発行してください`,
  );
}

/**
 * GitHub API 由来のエラー。生のレスポンス本文は保持せず（機密漏れ防止）、
 * ステータスと「どの操作か」だけを持つ。
 */
export class GhError extends Error {
  status: number;
  constructor(status: number, where: string) {
    super(`GitHub API error (${status}) at ${where}`);
    this.status = status;
  }
}

// ---- レスポンスヘルパー ----------------------------------------------------

/** JSON レスポンスを作る */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/** `{ error }` 形式のエラーレスポンス */
export function errorJson(status: number, message: string): Response {
  return json({ error: message }, status);
}

/**
 * ハンドラ本体を包んで、例外を安全な JSON エラーに変換する。
 * - HttpError → そのステータス/メッセージ（入力不正など）
 * - GhError → 502（GitHub 側の詳細やトークンは出さない）
 * - その他 → 500（詳細は出さない）
 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return errorJson(e.status, e.message);
    if (e instanceof GhError) return errorJson(502, `GitHub 連携でエラーが発生しました (${e.status})`);
    return errorJson(500, 'サーバー内部エラーが発生しました');
  }
}

/** リクエストボディを JSON として読む（壊れていたら 400） */
export async function readJsonBody<T>(request: Request): Promise<T> {
  const securityProblem = mutationRequestProblem({
    contentType: request.headers.get('Content-Type'),
    origin: request.headers.get('Origin'),
    fetchSite: request.headers.get('Sec-Fetch-Site'),
    expectedOrigin: new URL(request.url).origin,
  });
  if (securityProblem) {
    throw new HttpError(securityProblem.status, securityProblem.message);
  }
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'リクエストボディが不正な JSON です');
  }
}

// ---- UTF-8 base64（日本語対応） -------------------------------------------

/** バイト列 → base64（btoa は Latin-1 なので 1 バイトずつ char に詰めてから渡す） */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000; // 引数展開が過大にならないよう分割
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** base64 → バイト列（改行等の空白を除去してから atob） */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** 文字列（UTF-8）→ base64 */
export function encodeBase64(str: string): string {
  return bytesToBase64(new TextEncoder().encode(str));
}

/** base64 → 文字列（UTF-8） */
export function decodeBase64(b64: string): string {
  return new TextDecoder().decode(base64ToBytes(b64));
}

// ---- GitHub Contents API ---------------------------------------------------

function ghUrl(repo: string, path: string): string {
  return `https://api.github.com/repos/${OWNER}/${repo}/contents/${path}`;
}

function ghRepoUrl(repo: string, path = ''): string {
  return `https://api.github.com/repos/${OWNER}/${repo}${path}`;
}

function ghHeaders(
  env: Env,
  repo: string,
  accept = 'application/vnd.github+json',
): Record<string, string> {
  const token =
    repo === PUBLIC_REPO
      ? env.GITHUB_PUBLIC_TOKEN
      : env.GITHUB_PRIVATE_TOKEN;
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'User-Agent': 'bravers-admin',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * ファイルの生バイトを取得（Accept: application/vnd.github.raw）。
 * 無ければ null。1MB 超でも欠けずに取れる。
 */
export async function ghGetRaw(env: Env, repo: string, path: string): Promise<Uint8Array | null> {
  const res = await fetch(ghUrl(repo, path), {
    headers: ghHeaders(env, repo, 'application/vnd.github.raw'),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new GhError(res.status, `GET raw ${repo}/${path}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * ディレクトリ直下のファイル一覧を `{ 名前: blob sha }` で返す（無ければ空）。
 *
 * Contents APIのディレクトリ一覧は1,000件で欠落するため、最大100,000 entryの
 * Git Trees APIを階層ごとに辿る。144枚/弾でも7弾目から一覧が壊れない。
 */
export async function ghListDir(env: Env, repo: string, dir: string): Promise<Record<string, string>> {
  interface TreeResponse {
    truncated?: boolean;
    tree: Array<{
      path: string;
      type: 'blob' | 'tree' | 'commit';
      sha: string;
    }>;
  }
  const getTree = async (treeish: string): Promise<TreeResponse | null> => {
    const res = await fetch(
      ghRepoUrl(repo, `/git/trees/${encodeURIComponent(treeish)}`),
      { headers: ghHeaders(env, repo) },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new GhError(res.status, `GET tree ${repo}/${treeish}`);
    const body = (await res.json()) as TreeResponse;
    if (body.truncated) {
      throw new HttpError(
        409,
        `${repo}/${dir} の一覧が大きすぎて安全に取得できません`,
      );
    }
    return body;
  };

  const repoRes = await fetch(ghRepoUrl(repo), {
    headers: ghHeaders(env, repo),
  });
  if (!repoRes.ok) throw new GhError(repoRes.status, `GET repo ${repo}`);
  const repoInfo = (await repoRes.json()) as { default_branch?: string };
  if (!repoInfo.default_branch) {
    throw new GhError(502, `GET default branch ${repo}`);
  }

  let tree = await getTree(repoInfo.default_branch);
  if (!tree) return {};
  for (const segment of dir.split('/').filter(Boolean)) {
    const child = tree.tree.find(
      (entry) => entry.type === 'tree' && entry.path === segment,
    );
    if (!child) return {};
    tree = await getTree(child.sha);
    if (!tree) return {};
  }

  const out: Record<string, string> = {};
  for (const entry of tree.tree) {
    if (entry.type === 'blob') out[entry.path] = entry.sha;
  }
  return out;
}

/** ファイルの sha だけ取得（更新時に必要）。無ければ null */
export async function ghGetSha(env: Env, repo: string, path: string): Promise<string | null> {
  const res = await fetch(ghUrl(repo, path), {
    headers: ghHeaders(env, repo),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new GhError(res.status, `GET meta ${repo}/${path}`);
  const body = (await res.json()) as { sha: string };
  return body.sha;
}

/** JSON ファイルの読み取り結果（sha は書き戻しに使う。無ければ null） */
export interface JsonFile<T> {
  sha: string | null;
  data: T | null;
}

/**
 * JSON ファイルを読む。メタ（sha + base64 content）を 1 リクエストで取得し、
 * 1MB 超で content が欠ける場合だけ raw で取り直す。
 */
export async function ghGetJson<T>(env: Env, repo: string, path: string): Promise<JsonFile<T>> {
  const res = await fetch(ghUrl(repo, path), {
    headers: ghHeaders(env, repo),
  });
  if (res.status === 404) return { sha: null, data: null };
  if (!res.ok) throw new GhError(res.status, `GET ${repo}/${path}`);
  const body = (await res.json()) as { sha: string; content?: string; encoding?: string };
  let text: string;
  if (body.encoding === 'base64' && body.content) {
    text = decodeBase64(body.content);
  } else {
    const raw = await ghGetRaw(env, repo, path);
    text = raw ? new TextDecoder().decode(raw) : '';
  }
  return { sha: body.sha, data: text.trim() ? (JSON.parse(text) as T) : null };
}

/**
 * base64 コンテンツをファイルとして書き込む（作成 or 更新）。
 * sha を渡さなければ既存 sha を取りに行く（新規なら null → 作成）。
 */
export async function ghPutBase64(
  env: Env,
  repo: string,
  path: string,
  base64Content: string,
  message: string,
  sha?: string | null,
): Promise<void> {
  const effectiveSha = sha === undefined ? await ghGetSha(env, repo, path) : sha;
  const payload: Record<string, unknown> = { message, content: base64Content };
  if (effectiveSha) payload.sha = effectiveSha;
  const res = await fetch(ghUrl(repo, path), {
    method: 'PUT',
    headers: { ...ghHeaders(env, repo), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new GhError(res.status, `PUT ${repo}/${path}`);
}

/** ファイルを削除する。無ければ何もしない（引っ越しの後始末に使う） */
export async function ghDelete(env: Env, repo: string, path: string, message: string): Promise<boolean> {
  const sha = await ghGetSha(env, repo, path);
  if (!sha) return false;
  const res = await fetch(ghUrl(repo, path), {
    method: 'DELETE',
    headers: { ...ghHeaders(env, repo), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha }),
  });
  if (!res.ok) throw new GhError(res.status, `DELETE ${repo}/${path}`);
  return true;
}

/**
 * 画像を別のprintingIdへ引っ越す（コピーしてから元を消す）。
 * printingIdがそのままファイル名なので、採番をやり直したら必ずこれも動かす。
 */
export async function ghMoveImage(env: Env, repo: string, from: string, to: string): Promise<boolean> {
  const path = repo === PUBLIC_REPO ? publicImagePath : privateImagePath;
  const bytes = await ghGetRaw(env, repo, path(from));
  if (!bytes) return false;
  await ghPutBase64(env, repo, path(to), bytesToBase64(bytes), `move image ${from} -> ${to}`);
  await ghDelete(env, repo, path(from), `move image ${from} -> ${to}`);
  return true;
}

/** JSON 値を人が読める整形（2 スペース + 末尾改行）で書き込む */
export async function ghPutJson(
  env: Env,
  repo: string,
  path: string,
  value: unknown,
  message: string,
  sha?: string | null,
): Promise<void> {
  const text = JSON.stringify(value, null, 2) + '\n';
  await ghPutBase64(env, repo, path, encodeBase64(text), message, sha);
}

export type GitFileChange =
  | {
      path: string;
      bytes: Uint8Array;
      base64?: never;
    }
  | {
      path: string;
      /**
       * 既にbase64で届いた画像用。いったんバイト列へ戻して再変換すると
       * Cloudflare FreeのCPU枠を浪費するため、そのままGit blobへ渡す。
       */
      base64: string;
      bytes?: never;
    };

/** すでに同じリポジトリへ作成済みのblobをpathへ結ぶ。sha:nullは削除。 */
export interface GitFileReference {
  path: string;
  sha: string | null;
}

/** branchへはまだ結ばず、不可視のGit blobだけを作る。 */
async function ghCreateBase64Blob(
  env: Env,
  repo: string,
  base64: string,
): Promise<string> {
  const res = await fetch(ghRepoUrl(repo, '/git/blobs'), {
    method: 'POST',
    headers: { ...ghHeaders(env, repo), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: base64,
      encoding: 'base64',
    }),
  });
  if (!res.ok) throw new GhError(res.status, `POST blob ${repo}`);
  const body = (await res.json()) as { sha?: string };
  if (!body.sha) throw new GhError(502, `POST blob result ${repo}`);
  return body.sha;
}

export async function ghCreateBlob(
  env: Env,
  repo: string,
  bytes: Uint8Array,
): Promise<string> {
  return ghCreateBase64Blob(env, repo, bytesToBase64(bytes));
}

/**
 * 同一リポジトリの追加・差し替え・削除を1つのGit commitで反映する。
 *
 * referencesは同じリポ内の既存blobをrename/copyする時だけ使う。
 * blob/tree/commitの作成途中ではbranch refが動かず、最後のfast-forwardだけが確定点。
 */
export async function ghCommitFiles(
  env: Env,
  repo: string,
  changes: readonly GitFileChange[],
  message: string,
  expectedBlobShas: Readonly<Record<string, string | null>> = {},
  references: readonly GitFileReference[] = [],
): Promise<string | null> {
  if (changes.length === 0 && references.length === 0) return null;
  const paths = [
    ...changes.map((change) => change.path),
    ...references.map((reference) => reference.path),
  ];
  if (new Set(paths).size !== paths.length || paths.some((path) => path.trim() === '')) {
    throw new HttpError(400, 'Git commit対象のpathが空または重複しています');
  }
  if (
    references.some(
      (reference) =>
        reference.sha !== null &&
        (typeof reference.sha !== 'string' || reference.sha.trim() === ''),
    )
  ) {
    throw new HttpError(400, 'Git commit対象のblob SHAが不正です');
  }

  const request = async <T>(
    url: string,
    init: RequestInit = {},
    where: string,
  ): Promise<T> => {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...ghHeaders(env, repo),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) throw new GhError(res.status, where);
    return (await res.json()) as T;
  };

  const repoInfo = await request<{ default_branch: string }>(
    ghRepoUrl(repo),
    {},
    `GET repo ${repo}`,
  );
  const branch = repoInfo.default_branch;
  if (!branch) throw new GhError(502, `default branch ${repo}`);
  const refPath = branch.split('/').map(encodeURIComponent).join('/');
  const ref = await request<{ object: { sha: string } }>(
    ghRepoUrl(repo, `/git/ref/heads/${refPath}`),
    {},
    `GET ref ${repo}/${branch}`,
  );
  const baseCommitSha = ref.object.sha;
  const baseCommit = await request<{ tree: { sha: string } }>(
    ghRepoUrl(repo, `/git/commits/${baseCommitSha}`),
    {},
    `GET commit ${repo}/${baseCommitSha}`,
  );
  const expectedEntries = Object.entries(expectedBlobShas);
  if (expectedEntries.length > 0) {
    const currentTree = await request<{
      truncated?: boolean;
      tree: Array<{ path: string; type: string; sha: string }>;
    }>(
      ghRepoUrl(repo, `/git/trees/${baseCommit.tree.sha}?recursive=1`),
      {},
      `GET tree ${repo}/${baseCommit.tree.sha}`,
    );
    if (currentTree.truncated) {
      throw new HttpError(409, 'リポジトリが大きすぎて安全な同時更新確認ができません');
    }
    const currentByPath = new Map(
      currentTree.tree
        .filter((entry) => entry.type === 'blob')
        .map((entry) => [entry.path, entry.sha]),
    );
    for (const [path, expectedSha] of expectedEntries) {
      if ((currentByPath.get(path) ?? null) !== expectedSha) {
        throw new HttpError(
          409,
          `${path} が確認中に更新されました。再読み込みしてやり直してください`,
        );
      }
    }
  }

  const blobs: Array<{ path: string; sha: string }> = [];
  // 通常はJSON 1〜2件だけ。8件ずつに制限してWorkersの同時接続数も超えない。
  for (let start = 0; start < changes.length; start += 8) {
    const batch = changes.slice(start, start + 8);
    const shas = await Promise.all(
      batch.map((change) =>
        change.base64 === undefined
          ? ghCreateBlob(env, repo, change.bytes)
          : ghCreateBase64Blob(env, repo, change.base64),
      ),
    );
    blobs.push(
      ...batch.map((change, index) => ({
        path: change.path,
        sha: shas[index],
      })),
    );
  }

  const tree = [
    ...blobs.map((blob) => ({
      path: blob.path,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    })),
    ...references.map((reference) => ({
      path: reference.path,
      mode: '100644',
      type: 'blob',
      sha: reference.sha,
    })),
  ];
  const nextTree = await request<{ sha: string }>(
    ghRepoUrl(repo, '/git/trees'),
    {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
    },
    `POST tree ${repo}`,
  );
  const nextCommit = await request<{ sha: string }>(
    ghRepoUrl(repo, '/git/commits'),
    {
      method: 'POST',
      body: JSON.stringify({
        message,
        tree: nextTree.sha,
        parents: [baseCommitSha],
      }),
    },
    `POST commit ${repo}`,
  );
  const updateRef = await fetch(
    ghRepoUrl(repo, `/git/refs/heads/${refPath}`),
    {
      method: 'PATCH',
      headers: { ...ghHeaders(env, repo), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: nextCommit.sha, force: false }),
    },
  );
  if (!updateRef.ok) {
    if (updateRef.status === 409 || updateRef.status === 422) {
      throw new HttpError(
        409,
        'リポジトリが確認中に更新されました。再読み込みしてやり直してください',
      );
    }
    throw new GhError(updateRef.status, `PATCH ref ${repo}/${branch}`);
  }
  return nextCommit.sha;
}

export interface WorkflowDispatchResult {
  workflowRunId: number;
  runUrl: string;
  htmlUrl: string;
}

/** 非公開リポ上のworkflowを起動し、そのrun IDを同じレスポンスで受け取る。 */
export async function ghDispatchWorkflow(
  env: Env,
  repo: string,
  workflow: string,
  inputs: Readonly<Record<string, string>>,
): Promise<WorkflowDispatchResult> {
  const res = await fetch(
    ghRepoUrl(
      repo,
      `/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    ),
    {
      method: 'POST',
      headers: {
        ...ghHeaders(env, repo),
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2026-03-10',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs,
        return_run_details: true,
      }),
    },
  );
  if (res.status !== 200) {
    throw new GhError(res.status, `POST workflow dispatch ${repo}/${workflow}`);
  }
  const body = (await res.json()) as {
    workflow_run_id?: number;
    run_url?: string;
    html_url?: string;
  };
  if (
    !Number.isInteger(body.workflow_run_id) ||
    !body.run_url ||
    !body.html_url
  ) {
    throw new GhError(502, `POST workflow dispatch result ${repo}/${workflow}`);
  }
  return {
    workflowRunId: body.workflow_run_id!,
    runUrl: body.run_url,
    htmlUrl: body.html_url,
  };
}

export interface WorkflowRun {
  id: number;
  status:
    | 'queued'
    | 'in_progress'
    | 'completed'
    | 'requested'
    | 'waiting'
    | 'pending';
  conclusion:
    | 'success'
    | 'failure'
    | 'cancelled'
    | 'timed_out'
    | 'action_required'
    | 'neutral'
    | 'skipped'
    | 'stale'
    | null;
  htmlUrl: string;
}

function workflowRunFromBody(
  body: {
    id?: number;
    status?: WorkflowRun['status'];
    conclusion?: WorkflowRun['conclusion'];
    html_url?: string;
  },
  where: string,
): WorkflowRun {
  if (
    !Number.isInteger(body.id) ||
    !body.status ||
    !body.html_url
  ) {
    throw new GhError(502, where);
  }
  return {
    id: body.id!,
    status: body.status,
    conclusion: body.conclusion ?? null,
    htmlUrl: body.html_url,
  };
}

/** Access内の進捗表示用。ログ本文は取得せず、状態と非公開run URLだけを返す。 */
export async function ghGetWorkflowRun(
  env: Env,
  repo: string,
  runId: number,
): Promise<WorkflowRun> {
  const res = await fetch(ghRepoUrl(repo, `/actions/runs/${runId}`), {
    headers: {
      ...ghHeaders(env, repo),
      'X-GitHub-Api-Version': '2026-03-10',
    },
  });
  if (!res.ok) throw new GhError(res.status, `GET workflow run ${repo}/${runId}`);
  const body = (await res.json()) as {
    id?: number;
    status?: WorkflowRun['status'];
    conclusion?: WorkflowRun['conclusion'];
    html_url?: string;
  };
  const run = workflowRunFromBody(
    body,
    `GET workflow run result ${repo}/${runId}`,
  );
  if (run.id !== runId) {
    throw new GhError(502, `GET workflow run result ${repo}/${runId}`);
  }
  return run;
}

/**
 * 同じrequestIdの重複dispatchがあっても、最新runを見つける。
 * concurrency groupのpendingが置換されても、古いrun IDだけを失敗扱いしない。
 */
export async function ghFindWorkflowRun(
  env: Env,
  repo: string,
  workflow: string,
  displayTitle: string,
): Promise<WorkflowRun | null> {
  const params = new URLSearchParams({
    event: 'workflow_dispatch',
    per_page: '30',
  });
  const res = await fetch(
    ghRepoUrl(
      repo,
      `/actions/workflows/${encodeURIComponent(workflow)}/runs?${params}`,
    ),
    {
      headers: {
        ...ghHeaders(env, repo),
        'X-GitHub-Api-Version': '2026-03-10',
      },
    },
  );
  if (!res.ok) {
    throw new GhError(
      res.status,
      `GET workflow runs ${repo}/${workflow}`,
    );
  }
  const body = (await res.json()) as {
    workflow_runs?: Array<{
      id?: number;
      status?: WorkflowRun['status'];
      conclusion?: WorkflowRun['conclusion'];
      html_url?: string;
      display_title?: string;
    }>;
  };
  const match = (body.workflow_runs ?? [])
    .filter((run) => run.display_title === displayTitle)
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))[0];
  return match
    ? workflowRunFromBody(
        match,
        `GET workflow runs result ${repo}/${workflow}`,
      )
    : null;
}

// ---- 保存先の判定ロジック（vite.config.ts のローカル版と同じ規則） --------

/** その弾が released か */
export function isReleasedVol(vol: number, sets: MasterSet[]): boolean {
  return sets.find((s) => s.vol === vol)?.status === 'released';
}

/**
 * カードが「公開側（公開リポ data/cards.json）」に入るべきか。
 * カード個別が draft でなく、かつ その弾が released のときだけ公開側。
 * それ以外は非公開リポ cards/vol{N}.json。
 */
export function cardIsPublic(card: { vol: number; status?: string }, sets: MasterSet[]): boolean {
  return card.status !== 'draft' && isReleasedVol(card.vol, sets);
}

/**
 * 公開済みの弾は管理画面から一切変更できない。書き込み系の入口すべてで最初に呼ぶ。
 *
 * 実際に事故が起きた: 第2弾のつもりのカードが vol:1 で保存され、公開済みの第1弾に
 * 145枚目として紛れ込んで公開リポジトリに push された。engine のテスト
 * （枚数・画像の対応）が止めたので公開ビルドには載らなかったが、
 * 画像さえ付いていれば素通りしていた。
 *
 * 公開済みの弾を直す必要が出たら、リポジトリを直接編集して push する
 * （テストと CI を必ず通す）。管理画面には抜け道を用意しない。
 */
export function assertVolEditable(vol: number, sets: MasterSet[]): void {
  const status = sets.find((set) => set.vol === vol)?.status;
  if (status === 'released') {
    throw new HttpError(
      403,
      `第${vol}弾は公開済みのため、管理画面からは変更できません。` +
        `直す必要がある場合はリポジトリを直接編集してください。`,
    );
  }
  if (status === 'publishing') {
    throw new HttpError(
      409,
      `第${vol}弾は公開処理中のため変更できません。` +
        `「弾を公開」をもう一度実行して完了させてください。`,
    );
  }
}
