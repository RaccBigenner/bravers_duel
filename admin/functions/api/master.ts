/**
 * GET /api/master
 * 管理画面の初期データ `{ sets, cards }` を返す。
 * - sets  … 公開リポ data/sets.json の sets 配列
 * - cards … 公開リポ data/cards.json ＋ status!=='released' の各 vol について
 *           非公開リポ cards/vol{N}.json を連結（＝制作中の弾のカードもここで見える）
 */
import {
  CARDS_PATH,
  PRIVATE_REPO,
  PUBLIC_REPO,
  SETS_PATH,
  ghGetJson,
  handle,
  json,
  wipCardsPath,
  type Env,
  type MasterCard,
  type MasterSet,
  type SetsFile,
} from '../_github';

export const onRequestGet: PagesFunction<Env> = (ctx) =>
  handle(async () => {
    const env = ctx.env;

    const setsFile = (await ghGetJson<SetsFile>(env, PUBLIC_REPO, SETS_PATH)).data ?? { sets: [] };
    const sets: MasterSet[] = setsFile.sets ?? [];

    const publicCards = (await ghGetJson<MasterCard[]>(env, PUBLIC_REPO, CARDS_PATH)).data ?? [];

    // 未 released の弾ごとに非公開リポの制作中カードを集める（並列取得）
    const draftVols = sets.filter((s) => s.status !== 'released').map((s) => s.vol);
    const wipResults = await Promise.all(
      draftVols.map((v) => ghGetJson<MasterCard[]>(env, PRIVATE_REPO, wipCardsPath(v))),
    );
    const wipCards = wipResults.flatMap((r) => r.data ?? []);

    return json({ sets, cards: [...publicCards, ...wipCards] });
  });
