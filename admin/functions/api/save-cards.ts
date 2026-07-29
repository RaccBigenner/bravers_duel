/**
 * POST /api/save-cards  body: { vol, cards, renames? }
 *
 * その弾のカードを**まとめて**書き換える。並び替えと採番のための入口。
 *
 * 1枚ずつ /api/save-card を呼ぶと、100枚の弾では GitHub へ100往復することになり、
 * 遅いうえに途中で失敗すると並びが半端に残る。ここでは対象の弾のファイルを
 * 1回だけ読んで1回だけ書く。
 *
 * renames が付いていれば画像も引っ越す。カードidがそのまま画像のファイル名なので、
 * 採番をやり直すと、これをやらない限り全部の絵が迷子になる。
 * 画像を先に動かしてからカードを書く（逆にすると、新しいidに絵が無い状態が残る）。
 *
 * レスポンス: { ok:true, savedTo, saved, movedImages }
 */
import {
  CARDS_PATH,
  PRIVATE_REPO,
  PUBLIC_REPO,
  SETS_PATH,
  assertVolEditable,
  cardIsPublic,
  ghGetJson,
  ghMoveImage,
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

interface Rename {
  from: string;
  to: string;
}

export const onRequestPost: PagesFunction<Env> = (ctx) =>
  handle(async () => {
    const env = ctx.env;
    const { vol, cards, renames } = await readJsonBody<{
      vol: number;
      cards: MasterCard[] | null;
      renames?: Rename[];
    }>(ctx.request);

    // cards を省く（null）と「画像の引っ越しだけ」になる。
    // レアリティを変えて id が変わった時に使う（カード本体は save-card が書いている）
    if (typeof vol !== 'number' || (cards != null && !Array.isArray(cards))) {
      throw new HttpError(400, 'vol が必要です（cards は配列か null）');
    }
    if (cards?.some((c) => !c?.id || c.vol !== vol)) {
      throw new HttpError(400, 'cards には同じ vol のカードだけを入れてください');
    }

    const sets = (await ghGetJson<SetsFile>(env, PUBLIC_REPO, SETS_PATH)).data?.sets ?? [];
    assertVolEditable(vol, sets);

    // 画像を先に引っ越す
    let movedImages = 0;
    for (const { from, to } of renames ?? []) {
      if (!from || !to || from === to) continue;
      // 公開・非公開のどちらに置かれているか分からないので両方試す
      for (const repo of [PRIVATE_REPO, PUBLIC_REPO]) {
        if (await ghMoveImage(env, repo, from, to)) movedImages++;
      }
    }

    if (cards == null) {
      return json({ ok: true, savedTo: '(画像のみ)', saved: 0, movedImages });
    }

    // 保存先は弾単位で決まる（この弾は未公開なので実際は必ず非公開側）
    const toPublic = cardIsPublic({ vol, status: cards[0]?.status }, sets);
    const repo = toPublic ? PUBLIC_REPO : PRIVATE_REPO;
    const path = toPublic ? CARDS_PATH : wipCardsPath(vol);

    const file = await ghGetJson<MasterCard[]>(env, repo, path);
    // 同じファイルに他の弾が同居している場合（公開 cards.json）は、その弾ぶんだけ差し替える
    const others = (file.data ?? []).filter((c) => c.vol !== vol);
    await ghPutJson(env, repo, path, [...others, ...cards], `reorder vol${vol} (${cards.length} cards)`, file.sha);

    return json({ ok: true, savedTo: `${repo}/${path}`, saved: cards.length, movedImages });
  });
