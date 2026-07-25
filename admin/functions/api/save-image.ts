/**
 * POST /api/save-image  body: { id, vol, status, dataUrl }
 * カード画像（クライアントで webp 化した data URL）を保存する。
 * - save-card と同じ判定（status!=='draft' かつ 弾が released なら公開側）で
 *     公開リポ assets/card_images/{id}.webp か 非公開リポ images/{id}.webp に振り分ける。
 * - dataUrl の base64 部分はすでにバイト列の base64 なので、そのまま Contents API に渡せる。
 * レスポンス: { ok:true, savedTo }
 */
import {
  PRIVATE_REPO,
  PUBLIC_REPO,
  SETS_PATH,
  cardIsPublic,
  ghGetJson,
  ghPutBase64,
  handle,
  json,
  privateImagePath,
  publicImagePath,
  readJsonBody,
  HttpError,
  type Env,
  type SetsFile,
} from '../_github';

export const onRequestPost: PagesFunction<Env> = (ctx) =>
  handle(async () => {
    const env = ctx.env;
    const { id, vol, status, dataUrl } = await readJsonBody<{
      id: string;
      vol: number;
      status?: string;
      dataUrl: string;
    }>(ctx.request);

    const m = /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '');
    if (!id || typeof vol !== 'number' || !m) {
      throw new HttpError(400, 'id・vol・webp の dataUrl が必要です');
    }

    const sets = (await ghGetJson<SetsFile>(env, PUBLIC_REPO, SETS_PATH)).data?.sets ?? [];
    const toPublic = cardIsPublic({ vol, status }, sets);
    const repo = toPublic ? PUBLIC_REPO : PRIVATE_REPO;
    const path = toPublic ? publicImagePath(id) : privateImagePath(id);

    // 既存 sha は ghPutBase64 が内部で取得（新規なら作成）
    await ghPutBase64(env, repo, path, m[1], `save image ${id}`);

    return json({ ok: true, savedTo: `${repo}/${path}` });
  });
