/**
 * POST /api/save-card  body: { card }
 * カード 1 枚を保存する。
 * - 保存先は cardIsPublic 判定で決める：
 *     card.status!=='draft' かつ その弾が released → 公開リポ data/cards.json
 *     それ以外                                   → 非公開リポ cards/vol{vol}.json
 * - 対象ファイルを読み、同 id があれば差し替え・なければ追加して書き戻す。
 * - 反対側のファイルに同 id が残っていたら消す（released⇔draft 移動時の二重化防止。
 *   変化がある時だけ書く）。
 * レスポンス: { ok:true, savedTo }
 */
import {
  CARDS_PATH,
  PRIVATE_REPO,
  PUBLIC_REPO,
  SETS_PATH,
  cardIsPublic,
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
    const { card } = await readJsonBody<{ card: MasterCard }>(ctx.request);
    if (!card?.id || typeof card.vol !== 'number') {
      throw new HttpError(400, 'card.id と card.vol が必要です');
    }

    const sets = (await ghGetJson<SetsFile>(env, PUBLIC_REPO, SETS_PATH)).data?.sets ?? [];
    const toPublic = cardIsPublic(card, sets);

    const targetRepo = toPublic ? PUBLIC_REPO : PRIVATE_REPO;
    const targetPath = toPublic ? CARDS_PATH : wipCardsPath(card.vol);
    const otherRepo = toPublic ? PRIVATE_REPO : PUBLIC_REPO;
    const otherPath = toPublic ? wipCardsPath(card.vol) : CARDS_PATH;

    // 反対側に同 id が残っていたら消す（変化がある時だけ書く）
    const other = await ghGetJson<MasterCard[]>(env, otherRepo, otherPath);
    if (other.data) {
      const pruned = other.data.filter((c) => c.id !== card.id);
      if (pruned.length !== other.data.length) {
        await ghPutJson(env, otherRepo, otherPath, pruned, `remove ${card.id} (moved)`, other.sha);
      }
    }

    // 対象ファイルに差し替え / 追加
    const target = await ghGetJson<MasterCard[]>(env, targetRepo, targetPath);
    const list = target.data ?? [];
    const idx = list.findIndex((c) => c.id === card.id);
    if (idx >= 0) list[idx] = card;
    else list.push(card);
    await ghPutJson(env, targetRepo, targetPath, list, `save card ${card.id}`, target.sha);

    return json({ ok: true, savedTo: `${targetRepo}/${targetPath}` });
  });
