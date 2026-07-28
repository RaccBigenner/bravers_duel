/**
 * POST /api/delete-card  body: { id, vol }
 * 該当 id のカードを、公開・非公開どちらに入っていても消す
 * （公開リポ data/cards.json と 非公開リポ cards/vol{vol}.json の両方から除去。
 *   変化がある時だけ書く）。
 * レスポンス: { ok:true }
 */
import {
  CARDS_PATH,
  PRIVATE_REPO,
  PUBLIC_REPO,
  SETS_PATH,
  assertVolEditable,
  ghGetJson,
  ghPutJson,
  handle,
  json,
  readJsonBody,
  wipCardsPath,
  HttpError,
  type Env,
  type MasterCard,
  type SetsFile,
} from '../_github';

export const onRequestPost: PagesFunction<Env> = (ctx) =>
  handle(async () => {
    const env = ctx.env;
    const { id, vol } = await readJsonBody<{ id: string; vol: number }>(ctx.request);
    if (!id || typeof vol !== 'number') {
      throw new HttpError(400, 'id と vol が必要です');
    }

    const sets = (await ghGetJson<SetsFile>(env, PUBLIC_REPO, SETS_PATH)).data?.sets ?? [];
    assertVolEditable(vol, sets);

    const targets: Array<[string, string]> = [
      [PUBLIC_REPO, CARDS_PATH],
      [PRIVATE_REPO, wipCardsPath(vol)],
    ];

    for (const [repo, path] of targets) {
      const file = await ghGetJson<MasterCard[]>(env, repo, path);
      if (!file.data) continue;
      const pruned = file.data.filter((c) => c.id !== id);
      if (pruned.length !== file.data.length) {
        await ghPutJson(env, repo, path, pruned, `delete card ${id}`, file.sha);
      }
    }

    return json({ ok: true });
  });
