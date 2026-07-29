/**
 * POST /api/save-card  body: { card, originalPrintingId?, originalVol? }
 *
 * WIPカード1枚を保存する。Printing ID変更時のカードJSON・画像コピー・旧画像削除は
 * 非公開リポジトリの同一Git commitに入れ、途中状態や再試行不能な残骸を作らない。
 */
import {
  PRIVATE_IMAGE_DIR,
  PRIVATE_REPO,
  PUBLIC_REPO,
  SETS_PATH,
  WIP_SETS_PATH,
  assertVolEditable,
  ghCommitFiles,
  ghGetJson,
  ghListDir,
  handle,
  json,
  normalizeMasterCards,
  privateImagePath,
  readJsonBody,
  requireCanonicalMasterCard,
  requireCanonicalMasterCards,
  wipCardsPath,
  HttpError,
  type Env,
  type GitFileReference,
  type SetsFile,
} from '../_github';

const encodeJson = (value: unknown) =>
  new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

export const onRequestPost: PagesFunction<Env> = (ctx) =>
  handle(async () => {
    const env = ctx.env;
    const {
      card: rawCard,
      originalPrintingId,
      originalVol,
    } = await readJsonBody<{
      card: Record<string, unknown>;
      originalPrintingId?: string;
      originalVol?: number;
    }>(ctx.request);
    if (!rawCard || typeof rawCard.vol !== 'number') {
      throw new HttpError(400, 'card と card.vol が必要です');
    }
    if (
      (originalPrintingId == null) !== (originalVol == null) ||
      (originalPrintingId != null && originalPrintingId.trim() === '') ||
      (originalVol != null &&
        (!Number.isInteger(originalVol) || originalVol < 1))
    ) {
      throw new HttpError(
        400,
        '編集時は originalPrintingId と originalVol の両方が必要です',
      );
    }
    const card = requireCanonicalMasterCard(rawCard);

    const [publicSetsFile, wipSetsFile, imageDirectory] = await Promise.all([
      ghGetJson<SetsFile>(env, PUBLIC_REPO, SETS_PATH),
      ghGetJson<SetsFile>(env, PRIVATE_REPO, WIP_SETS_PATH),
      ghListDir(env, PRIVATE_REPO, PRIVATE_IMAGE_DIR),
    ]);
    const lifecycleSets = [
      ...(publicSetsFile.data?.sets ?? []),
      ...(wipSetsFile.data?.sets ?? []),
    ];
    assertVolEditable(card.vol, lifecycleSets);
    if (originalVol != null) assertVolEditable(originalVol, lifecycleSets);

    const targetPath = wipCardsPath(card.vol);
    const sourcePath =
      originalVol == null ? targetPath : wipCardsPath(originalVol);
    const [targetFile, sourceFile] = await Promise.all([
      ghGetJson<Record<string, unknown>[]>(
        env,
        PRIVATE_REPO,
        targetPath,
      ),
      sourcePath === targetPath
        ? Promise.resolve(null)
        : ghGetJson<Record<string, unknown>[]>(
            env,
            PRIVATE_REPO,
            sourcePath,
          ),
    ]);
    const targetCards = normalizeMasterCards(targetFile.data ?? []);
    const sourceData = sourceFile ?? targetFile;
    const sourceCards =
      sourcePath === targetPath
        ? targetCards
        : normalizeMasterCards(sourceData.data ?? []);
    if (targetCards.some((existing) => existing.vol !== card.vol)) {
      throw new HttpError(409, `${targetPath} に別volのカードがあります`);
    }

    const expected: Record<string, string | null> = {
      [targetPath]: targetFile.sha,
      [WIP_SETS_PATH]: wipSetsFile.sha,
    };
    if (sourcePath !== targetPath) expected[sourcePath] = sourceData.sha;

    if (originalPrintingId == null || originalVol == null) {
      const existing = targetCards.find(
        (candidate) => candidate.printingId === card.printingId,
      );
      if (existing) {
        if (
          JSON.stringify(requireCanonicalMasterCard(existing)) ===
          JSON.stringify(card)
        ) {
          return json({
            ok: true,
            savedTo: `${PRIVATE_REPO}/${targetPath}`,
            movedImage: false,
            cleanupPending: false,
            alreadySaved: true,
          });
        }
        throw new HttpError(409, `${card.printingId} は既に存在します`);
      }
      const imagePath = privateImagePath(card.printingId);
      if (imageDirectory[`${card.printingId}.webp`]) {
        throw new HttpError(
          409,
          `${card.printingId} の孤立画像が既にあります。先に画像を整理してください`,
        );
      }
      expected[imagePath] = null;
      await ghCommitFiles(
        env,
        PRIVATE_REPO,
        [
          {
            path: targetPath,
            bytes: encodeJson(
              requireCanonicalMasterCards([...targetCards, card]),
            ),
          },
        ],
        `add card ${card.printingId}`,
        expected,
      );
      return json({
        ok: true,
        savedTo: `${PRIVATE_REPO}/${targetPath}`,
        movedImage: false,
        cleanupPending: false,
      });
    }

    const sourceIndex = sourceCards.findIndex(
      (existing) => existing.printingId === originalPrintingId,
    );
    const identityChanged =
      originalPrintingId !== card.printingId || originalVol !== card.vol;

    // 旧逐次版でカードだけ移動済み・旧画像削除だけ失敗した状態も冪等に救う。
    if (sourceIndex < 0 && identityChanged) {
      const completed = targetCards.find(
        (existing) => existing.printingId === card.printingId,
      );
      if (
        !completed ||
        JSON.stringify(requireCanonicalMasterCard(completed)) !==
          JSON.stringify(card)
      ) {
        throw new HttpError(
          409,
          `変更元 ${originalPrintingId} が見つかりません。再読み込みしてください`,
        );
      }
      const staleImagePath = privateImagePath(originalPrintingId);
      const staleSha = imageDirectory[`${originalPrintingId}.webp`];
      const completedImagePath = privateImagePath(card.printingId);
      const completedImageSha = imageDirectory[`${card.printingId}.webp`];
      let restoredImage = false;
      if (staleSha) {
        const references: GitFileReference[] = [
          { path: staleImagePath, sha: null },
        ];
        const cleanupExpected: Record<string, string | null> = {
          [WIP_SETS_PATH]: wipSetsFile.sha,
          [targetPath]: targetFile.sha,
          [staleImagePath]: staleSha,
          [completedImagePath]: completedImageSha ?? null,
        };
        if (!completedImageSha) {
          references.unshift({
            path: completedImagePath,
            sha: staleSha,
          });
          restoredImage = true;
        }
        await ghCommitFiles(
          env,
          PRIVATE_REPO,
          [],
          `finish old image cleanup ${originalPrintingId}`,
          cleanupExpected,
          references,
        );
      }
      return json({
        ok: true,
        savedTo: `${PRIVATE_REPO}/${targetPath}`,
        movedImage: restoredImage || Boolean(completedImageSha),
        cleanupPending: false,
      });
    }
    if (sourceIndex < 0) {
      throw new HttpError(
        409,
        `変更元 ${originalPrintingId} が見つかりません。再読み込みしてください`,
      );
    }
    if (sourceCards[sourceIndex].vol !== originalVol) {
      throw new HttpError(
        409,
        `変更元 ${originalPrintingId} のvolが一致しません`,
      );
    }
    if (
      identityChanged &&
      targetCards.some(
        (existing) => existing.printingId === card.printingId,
      )
    ) {
      throw new HttpError(
        409,
        `移動先 ${card.printingId} は別カードが使用しています`,
      );
    }

    const changes: Array<{ path: string; bytes: Uint8Array }> = [];
    if (sourcePath === targetPath) {
      const output = [...sourceCards];
      output[sourceIndex] = card;
      changes.push({
        path: targetPath,
        bytes: encodeJson(requireCanonicalMasterCards(output)),
      });
    } else {
      changes.push(
        {
          path: targetPath,
          bytes: encodeJson(
            requireCanonicalMasterCards([...targetCards, card]),
          ),
        },
        {
          path: sourcePath,
          bytes: encodeJson(
            requireCanonicalMasterCards(
              sourceCards.filter(
                (existing) =>
                  existing.printingId !== originalPrintingId,
              ),
            ),
          ),
        },
      );
    }

    const imageReferences: GitFileReference[] = [];
    let movedImage = false;
    if (identityChanged) {
      const sourceImagePath = privateImagePath(originalPrintingId);
      const targetImagePath = privateImagePath(card.printingId);
      const sourceImageSha =
        imageDirectory[`${originalPrintingId}.webp`] ?? null;
      const targetImageSha =
        imageDirectory[`${card.printingId}.webp`] ?? null;
      if (targetImageSha) {
        throw new HttpError(
          409,
          `移動先 ${card.printingId} の画像は既に存在します`,
        );
      }
      expected[sourceImagePath] = sourceImageSha;
      expected[targetImagePath] = null;
      if (sourceImageSha) {
        imageReferences.push(
          { path: targetImagePath, sha: sourceImageSha },
          { path: sourceImagePath, sha: null },
        );
        movedImage = true;
      }
    }

    await ghCommitFiles(
      env,
      PRIVATE_REPO,
      changes,
      `save card ${originalPrintingId} -> ${card.printingId}`,
      expected,
      imageReferences,
    );
    return json({
      ok: true,
      savedTo: `${PRIVATE_REPO}/${targetPath}`,
      movedImage,
      cleanupPending: false,
    });
  });
