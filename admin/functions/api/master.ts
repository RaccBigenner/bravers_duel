/**
 * GET /api/master
 * 管理画面の初期データ `{ sets, cards, images }` を返す。
 * - sets   … 公開リポ data/sets.json（公開済みの弾）＋ 非公開リポ sets.wip.json（制作中の弾）
 * - cards  … 公開リポ data/cards.json ＋ status!=='released' の各 vol について
 *            非公開リポ cards/vol{N}.json を連結（＝制作中の弾のカードもここで見える）
 * - images … `{ カードid: blob sha }`。画像ディレクトリ一覧を 2 リクエストで取ってまとめる。
 *            管理画面はこれで「画像の有無」を判定し（1枚ずつ叩かない）、
 *            画像URLの `?v=` にも使う（中身が変わった時だけ取り直す）。
 */
import {
  CARDS_PATH,
  PRIVATE_IMAGE_DIR,
  PRIVATE_REPO,
  PUBLIC_IMAGE_DIR,
  PUBLIC_REPO,
  SETS_PATH,
  WIP_CARDS_DIR,
  WIP_SETS_PATH,
  ghGetJson,
  ghListDir,
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

    // 制作中カードの置き場を「弾メタ任せ」にしない。
    // 弾メタ(sets.wip.json)が何かの拍子に消えると、cards/volN.json が残っていても
    // 読みに行かれず、カードが丸ごと消えたように見える（実際に一度起きた）。
    // そこで cards/ を直接見て、ファイルがある vol は必ず読む。
    const cardFiles = await ghListDir(env, PRIVATE_REPO, WIP_CARDS_DIR);
    const fileVols = Object.keys(cardFiles)
      .map((name) => /^vol(\d+)\.json$/.exec(name)?.[1])
      .filter((v): v is string => !!v)
      .map(Number);
    const draftVols = sets.filter((s) => s.status !== 'released').map((s) => s.vol);
    const volsToLoad = [...new Set([...draftVols, ...fileVols])].sort((a, b) => a - b);

    const wipResults = await Promise.all(
      volsToLoad.map((v) => ghGetJson<MasterCard[]>(env, PRIVATE_REPO, wipCardsPath(v))),
    );
    const wipCards = wipResults.flatMap((r) => r.data ?? []);

    // 弾メタが無いのにカードだけある vol（＝迷子）。タブは出して編集できるようにし、
    // 画面には警告を出す。黙って消えるより、見えて直せるほうが安全。
    const orphanVols = fileVols.filter((v) => !byVol.has(v) && wipCards.some((c) => c.vol === v));
    for (const v of orphanVols) {
      sets.push({
        vol: v, themeNo: v, themeName: '', themeSubtitle: '', packType: 'DX',
        status: 'draft', releasedAt: '', codename: '',
      } as MasterSet);
    }
    sets.sort((a, b) => a.vol - b.vol);

    // 画像一覧（公開側 → 非公開側の順に重ね、同名は公開側を優先＝配信と同じ探索順）
    const [privImages, pubImages] = await Promise.all([
      ghListDir(env, PRIVATE_REPO, PRIVATE_IMAGE_DIR),
      ghListDir(env, PUBLIC_REPO, PUBLIC_IMAGE_DIR),
    ]);
    const images: Record<string, string> = {};
    for (const [file, sha] of [...Object.entries(privImages), ...Object.entries(pubImages)]) {
      if (file.startsWith('.')) continue; // .gitkeep など
      images[file.replace(/\.[^.]+$/, '')] = sha.slice(0, 10);
    }

    // 公開済みの弾に制作中カードが残っていた場合に二重に出さない（同 id は公開側を正とする）
    const byId = new Map<string, MasterCard>();
    for (const c of [...publicCards, ...wipCards]) if (!byId.has(c.id)) byId.set(c.id, c);

    return json({ sets, cards: [...byId.values()], images, orphanVols });
  });
