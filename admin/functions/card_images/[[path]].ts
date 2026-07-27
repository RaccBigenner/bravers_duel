/**
 * GET /card_images/{name}
 * カード画像とカードデザイン素材（枠・属性アイコン・プレート）を配信する。
 * まず公開リポ assets/card_images/{name}、無ければ非公開リポ images/{name}。
 *
 * キャッシュ方針:
 * - `?v=` 付き（= /api/master が返す blob sha を付けて呼ぶカード画像）は
 *   中身が変わればURLも変わるので、1年 immutable でブラウザに焼き付ける。
 *   これをやらないと一覧を開くたびに全枚数を GitHub から取り直すことになり、
 *   スマホでは目に見えて遅い。
 * - `?v=` 無し（デザイン素材など）は 5 分だけキャッシュし、ETag で再検証する。
 *
 * Content-Type は拡張子から決める。デザイン素材には .png もあるため、
 * 全部 image/webp で返すと表示できない。
 */
import {
  PRIVATE_REPO,
  PUBLIC_REPO,
  ghGetRaw,
  handle,
  type Env,
} from '../_github';

const MIME: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

export const onRequestGet: PagesFunction<Env> = (ctx) =>
  handle(async () => {
    const raw = ctx.params.path;
    const name = decodeURIComponent(Array.isArray(raw) ? raw.join('/') : (raw ?? ''));

    // パストラバーサル対策（ファイル名だけを許可）
    if (!name || name.includes('..') || name.includes('/')) {
      return new Response('bad request', { status: 400 });
    }

    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const contentType = MIME[ext] ?? 'application/octet-stream';
    const version = new URL(ctx.request.url).searchParams.get('v');

    // 公開 → 無ければ非公開 の順で探す
    const find = async () =>
      (await ghGetRaw(ctx.env, PUBLIC_REPO, `assets/card_images/${name}`)) ??
      (await ghGetRaw(ctx.env, PRIVATE_REPO, `images/${name}`));

    let bytes = await find();
    // 上げた直後は GitHub 側の反映に数秒かかることがあり、そのままだと
    // 「保存できたのに画像が出ない」に見える。版番号つき（＝上げ直した直後）の時だけ一度待って再取得する。
    if (!bytes && version) {
      await new Promise((r) => setTimeout(r, 1200));
      bytes = await find();
    }
    if (!bytes) return new Response('not found', { status: 404 });

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': version
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=300',
      },
    });
  });
