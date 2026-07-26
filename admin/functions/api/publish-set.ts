/**
 * POST /api/publish-set  body: { vol }
 * 指定の弾を「公開」する。処理は冪等（再実行しても壊れない）に組み、
 * 「公開側を全部書いてから最後に sets を released に」して、部分失敗でも
 * 公開状態が中途半端にならないようにしている。
 *
 * 手順（この順序が重要）:
 *   1. 非公開リポ cards/vol{vol}.json を読み、status:'draft' を外す（＝弾に従わせる）。
 *   2. 公開リポ data/cards.json に追記（同 id は差し替え）→ 書き込み。
 *   3. 非公開リポ images/{id}.webp を 公開リポ assets/card_images/{id}.webp にコピー。
 *   4. 弾メタを 非公開リポ sets.wip.json → 公開リポ data/sets.json へ status:'released' で移す
 *      （＝ここで初めて公開状態が確定。制作中のテーマ名・サブタイトルはこの瞬間まで公開側に無い）。
 *   5. 最後に 非公開リポ cards/vol{vol}.json を空配列にし、sets.wip.json から当該 vol を消す。
 *
 * 途中で失敗した場合: 4 が終わるまで弾は released にならず、GET /api/master は
 * 非公開リポの wip カードを正とみなし続ける。再実行すれば同じ id を上書きして
 * 続きから完了できる（重複カードは一時的に出得るが、再実行で解消する）。
 * レスポンス: { ok:true, moved }
 */
import {
  CARDS_PATH,
  PRIVATE_REPO,
  PUBLIC_REPO,
  SETS_PATH,
  WIP_SETS_PATH,
  bytesToBase64,
  ghGetJson,
  ghGetRaw,
  ghPutBase64,
  ghPutJson,
  handle,
  json,
  privateImagePath,
  publicImagePath,
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
    const { vol } = await readJsonBody<{ vol: number }>(ctx.request);
    if (typeof vol !== 'number') {
      throw new HttpError(400, 'vol が必要です');
    }

    // 1. 非公開リポの制作中カードを読み、status:'draft' を外す
    const wip = await ghGetJson<MasterCard[]>(env, PRIVATE_REPO, wipCardsPath(vol));
    const wipCards = wip.data ?? [];
    const promoted: MasterCard[] = wipCards.map((c) => {
      if (c.status === 'draft') {
        const { status: _drop, ...rest } = c;
        return rest as MasterCard;
      }
      return c;
    });

    // 2. 公開 data/cards.json に追記（同 id は差し替え）→ 変化がある時だけ書く
    const pub = await ghGetJson<MasterCard[]>(env, PUBLIC_REPO, CARDS_PATH);
    const list = pub.data ?? [];
    const before = JSON.stringify(list);
    const indexById = new Map(list.map((c, i) => [c.id, i]));
    for (const c of promoted) {
      const i = indexById.get(c.id);
      if (i !== undefined) list[i] = c;
      else {
        indexById.set(c.id, list.length);
        list.push(c);
      }
    }
    if (JSON.stringify(list) !== before) {
      await ghPutJson(env, PUBLIC_REPO, CARDS_PATH, list, `publish vol${vol}: cards`, pub.sha);
    }

    // 3. 画像コピー（非公開 images/{id}.webp → 公開 assets/card_images/{id}.webp）
    for (const c of promoted) {
      const raw = await ghGetRaw(env, PRIVATE_REPO, privateImagePath(c.id));
      if (!raw) continue; // 画像が無いカードはスキップ
      await ghPutBase64(env, PUBLIC_REPO, publicImagePath(c.id), bytesToBase64(raw), `publish vol${vol}: image ${c.id}`);
    }

    // 4. 弾メタを非公開リポ → 公開リポへ released で移す（＝公開の確定点）
    const wipSetsFile = await ghGetJson<SetsFile>(env, PRIVATE_REPO, WIP_SETS_PATH);
    const wipSets = wipSetsFile.data?.sets ?? [];
    const setsFile = await ghGetJson<SetsFile>(env, PUBLIC_REPO, SETS_PATH);
    const base: SetsFile = setsFile.data ?? { sets: [] };
    const sets = base.sets ?? [];
    // 元になる弾メタは「制作中側 → 既に公開側にあるならそれ」の順で探す（再実行しても壊れない）
    const source = wipSets.find((s) => s.vol === vol) ?? sets.find((s) => s.vol === vol);
    if (!source) {
      throw new HttpError(404, `vol${vol} の弾が見つかりません`);
    }
    const si = sets.findIndex((s) => s.vol === vol);
    if (si < 0 || sets[si].status !== 'released') {
      const released = { ...source, status: 'released' };
      if (si >= 0) sets[si] = released;
      else sets.push(released);
      sets.sort((a, b) => a.vol - b.vol);
      await ghPutJson(env, PUBLIC_REPO, SETS_PATH, { ...base, sets }, `publish vol${vol}: mark released`, setsFile.sha);
    }

    // 5. 最後に非公開リポの制作中カードを空配列にし、制作中の弾メタからも消す（変化がある時だけ）
    if (wipCards.length > 0) {
      await ghPutJson(env, PRIVATE_REPO, wipCardsPath(vol), [], `publish vol${vol}: clear wip`, wip.sha);
    }
    if (wipSets.some((s) => s.vol === vol)) {
      await ghPutJson(
        env,
        PRIVATE_REPO,
        WIP_SETS_PATH,
        { ...(wipSetsFile.data ?? { sets: [] }), sets: wipSets.filter((s) => s.vol !== vol) },
        `publish vol${vol}: clear wip set`,
        wipSetsFile.sha,
      );
    }

    return json({ ok: true, moved: promoted.length });
  });
