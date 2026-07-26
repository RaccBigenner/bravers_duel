/**
 * GET /api/master
 * 管理画面の初期データ `{ sets, cards }` を返す。
 * - sets  … 公開リポ data/sets.json（公開済みの弾）＋ 非公開リポ sets.wip.json（制作中の弾）
 * - cards … 公開リポ data/cards.json ＋ status!=='released' の各 vol について
 *           非公開リポ cards/vol{N}.json を連結（＝制作中の弾のカードもここで見える）
 */
import {
  CARDS_PATH,
  PRIVATE_REPO,
  PUBLIC_REPO,
  SETS_PATH,
  WIP_SETS_PATH,
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

    // 弾メタは2か所に分かれている（公開済み＝公開リポ / 制作中＝非公開リポ）。
    // 管理画面では両方見えないと編集できないので、ここで束ねる。同 vol は制作中側を優先。
    const [pubSetsFile, wipSetsFile] = await Promise.all([
      ghGetJson<SetsFile>(env, PUBLIC_REPO, SETS_PATH),
      ghGetJson<SetsFile>(env, PRIVATE_REPO, WIP_SETS_PATH),
    ]);
    const byVol = new Map<number, MasterSet>();
    for (const s of [...(pubSetsFile.data?.sets ?? []), ...(wipSetsFile.data?.sets ?? [])]) byVol.set(s.vol, s);
    const sets: MasterSet[] = [...byVol.values()].sort((a, b) => a.vol - b.vol);

    const publicCards = (await ghGetJson<MasterCard[]>(env, PUBLIC_REPO, CARDS_PATH)).data ?? [];

    // 未 released の弾ごとに非公開リポの制作中カードを集める（並列取得）
    const draftVols = sets.filter((s) => s.status !== 'released').map((s) => s.vol);
    const wipResults = await Promise.all(
      draftVols.map((v) => ghGetJson<MasterCard[]>(env, PRIVATE_REPO, wipCardsPath(v))),
    );
    const wipCards = wipResults.flatMap((r) => r.data ?? []);

    return json({ sets, cards: [...publicCards, ...wipCards] });
  });
