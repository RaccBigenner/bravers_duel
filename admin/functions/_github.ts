/**
 * GitHub 連携の共通処理（Cloudflare Pages Functions / Workers 環境）。
 *
 * - 先頭が `_` のファイルは Pages のファイルルーティング対象外なので、
 *   各エンドポイントから import して使うヘルパー置き場に使える。
 * - GitHub REST Contents API を `fetch` で直接叩く（octokit は使わない）。
 * - 日本語を含む JSON を扱うため、base64 は必ず UTF-8 対応で行う
 *   （`atob`/`btoa` は Latin-1 なので TextEncoder/TextDecoder と組み合わせる）。
 * - トークン（env.GITHUB_TOKEN）は Authorization ヘッダにだけ使い、
 *   レスポンスやエラーメッセージには絶対に含めない。
 */

/** Pages Functions のバインディング。GITHUB_TOKEN は両リポに Contents:read/write の PAT */
export interface Env {
  GITHUB_TOKEN: string;
  /** Cloudflare Access のチーム(認証)ドメイン。例: https://xxxx.cloudflareaccess.com */
  CF_ACCESS_TEAM_DOMAIN: string;
  /** Access アプリケーションの Audience(AUD) タグ */
  CF_ACCESS_AUD: string;
}

/** 保存形式のカード（type ごとにフィールドが違うので緩めに持つ） */
export interface MasterCard {
  id: string;
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
export const publicImagePath = (id: string): string => `${PUBLIC_IMAGE_DIR}/${id}.webp`;
/** 非公開リポのカード画像パス */
export const privateImagePath = (id: string): string => `${PRIVATE_IMAGE_DIR}/${id}.webp`;
/** 非公開リポの制作中カードのディレクトリ */
export const WIP_CARDS_DIR = 'cards';
/** 非公開リポの制作中カード配列パス */
export const wipCardsPath = (vol: number): string => `${WIP_CARDS_DIR}/vol${vol}.json`;
/**
 * 非公開リポの「制作中の弾メタ」パス。
 * 公開リポの data/sets.json は丸ごとブラウザに配信されるので、未公開の弾の
 * テーマ名・サブタイトルを書くと必ず外から読める（実際に第2弾のサブタイトルが漏れていた）。
 * カードと同じく、制作中の弾メタは非公開リポだけに置く。
 */
export const WIP_SETS_PATH = 'sets.wip.json';

// ---- エラー型 --------------------------------------------------------------

/** 入力不正など、クライアントにそのまま返してよいエラー */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
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
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
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

function ghHeaders(env: Env, accept = 'application/vnd.github+json'): Record<string, string> {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
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
  const res = await fetch(ghUrl(repo, path), { headers: ghHeaders(env, 'application/vnd.github.raw') });
  if (res.status === 404) return null;
  if (!res.ok) throw new GhError(res.status, `GET raw ${repo}/${path}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * ディレクトリ直下のファイル一覧を `{ 名前: blob sha }` で返す（無ければ空）。
 *
 * 画像の有無を「1枚ずつ叩いて確かめる」と枚数ぶんのリクエストになるので、
 * ここで 1 リクエストにまとめる。sha はそのまま画像URLの版番号に使い、
 * 中身が変わった時だけURLが変わる＝ブラウザに長期キャッシュさせられる。
 */
export async function ghListDir(env: Env, repo: string, dir: string): Promise<Record<string, string>> {
  const res = await fetch(ghUrl(repo, dir), { headers: ghHeaders(env) });
  if (res.status === 404) return {};
  if (!res.ok) throw new GhError(res.status, `GET dir ${repo}/${dir}`);
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) return {};
  const out: Record<string, string> = {};
  for (const e of body as { name?: string; sha?: string; type?: string }[]) {
    if (e.type === 'file' && e.name && e.sha) out[e.name] = e.sha;
  }
  return out;
}

/** ファイルの sha だけ取得（更新時に必要）。無ければ null */
export async function ghGetSha(env: Env, repo: string, path: string): Promise<string | null> {
  const res = await fetch(ghUrl(repo, path), { headers: ghHeaders(env) });
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
  const res = await fetch(ghUrl(repo, path), { headers: ghHeaders(env) });
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
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new GhError(res.status, `PUT ${repo}/${path}`);
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
