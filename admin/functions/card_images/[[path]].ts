/**
 * GET /card_images/{id}.webp
 * カード画像を配信する。まず公開リポ assets/card_images/{id}.webp、
 * 無ければ非公開リポ images/{id}.webp を GitHub から生バイトで取得して返す。
 * - Content-Type: image/webp
 * - Cache-Control: no-store（管理画面で差し替え直後の画像を確実に反映させるため）
 */
import {
  PRIVATE_REPO,
  PUBLIC_REPO,
  ghGetRaw,
  handle,
  type Env,
} from '../_github';

export const onRequestGet: PagesFunction<Env> = (ctx) =>
  handle(async () => {
    const raw = ctx.params.path;
    const name = decodeURIComponent(Array.isArray(raw) ? raw.join('/') : (raw ?? ''));

    // パストラバーサル対策（ファイル名だけを許可）
    if (!name || name.includes('..') || name.includes('/')) {
      return new Response('bad request', { status: 400 });
    }

    // 公開 → 無ければ非公開 の順で探す
    let bytes = await ghGetRaw(ctx.env, PUBLIC_REPO, `assets/card_images/${name}`);
    if (!bytes) bytes = await ghGetRaw(ctx.env, PRIVATE_REPO, `images/${name}`);
    if (!bytes) return new Response('not found', { status: 404 });

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'no-store',
      },
    });
  });
