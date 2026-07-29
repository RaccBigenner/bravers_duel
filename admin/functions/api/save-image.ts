/**
 * POST /api/save-image  body: { printingId, vol, dataUrl }
 * 保存済みの制作中カードにだけ、webp画像を保存する。
 * 公開画像はpublish-setだけが変更し、このAPIは非公開リポ以外へ書かない。
 * - dataUrl の base64 部分はすでにバイト列の base64 なので、そのまま Contents API に渡せる。
 * レスポンス: { ok:true, savedTo }
 */
import {
  assertVolEditable,
  PRIVATE_REPO,
  PUBLIC_REPO,
  SETS_PATH,
  WIP_SETS_PATH,
  ghCommitFiles,
  ghGetJson,
  ghGetSha,
  handle,
  json,
  normalizeMasterCards,
  privateImagePath,
  readJsonBody,
  wipCardsPath,
  HttpError,
  type Env,
  type SetsFile,
} from '../_github';
import {
  webpBase64Payload,
  webpBase64Problem,
} from '../../shared/webp';

export const onRequestPost: PagesFunction<Env> = (ctx) =>
  handle(async () => {
    const env = ctx.env;
    const { printingId: rawPrintingId, id: legacyId, vol, dataUrl } = await readJsonBody<{
      printingId?: string;
      /** 開きっぱなしの旧管理画面からの画像送信だけは互換入力として受ける */
      id?: string;
      vol: number;
      dataUrl: string;
    }>(ctx.request);

    const printingId = rawPrintingId ?? legacyId;
    const base64 = webpBase64Payload(dataUrl);
    if (!printingId || typeof vol !== 'number' || !base64) {
      throw new HttpError(400, 'printingId・vol・webp の dataUrl が必要です');
    }
    const imageProblem = webpBase64Problem(base64);
    if (imageProblem) throw new HttpError(400, imageProblem);

    const cardPath = wipCardsPath(vol);
    const imagePath = privateImagePath(printingId);
    const [publicSetsFile, wipSetsFile, cardFile, imageSha] =
      await Promise.all([
        ghGetJson<SetsFile>(env, PUBLIC_REPO, SETS_PATH),
        ghGetJson<SetsFile>(env, PRIVATE_REPO, WIP_SETS_PATH),
        ghGetJson<Record<string, unknown>[]>(
          env,
          PRIVATE_REPO,
          cardPath,
        ),
        ghGetSha(env, PRIVATE_REPO, imagePath),
      ]);
    assertVolEditable(vol, [
      ...(publicSetsFile.data?.sets ?? []),
      ...(wipSetsFile.data?.sets ?? []),
    ]);

    // printingIdをそのままパスへ使う前に、正規化済みカード一覧との完全一致を要求する。
    // これで任意パス・削除済みID・未保存カードの孤立画像を作れない。
    const cards = normalizeMasterCards(cardFile.data ?? []);
    const owner = cards.find((card) => card.printingId === printingId);
    if (!owner || owner.vol !== vol) {
      throw new HttpError(
        409,
        `${printingId} はvol${vol}の保存済みWIPカードではありません`,
      );
    }
    await ghCommitFiles(
      env,
      PRIVATE_REPO,
      [{ path: imagePath, base64 }],
      `save image ${printingId}`,
      {
        [WIP_SETS_PATH]: wipSetsFile.sha,
        [cardPath]: cardFile.sha,
        [imagePath]: imageSha,
      },
    );

    return json({
      ok: true,
      savedTo: `${PRIVATE_REPO}/${imagePath}`,
    });
  });
