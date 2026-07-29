/**
 * POST /api/save-cards  body: { vol, cards, renames? }
 *
 * 並び保存または一括採番を行う。カードJSONと全画像renameを非公開リポジトリの
 * 同一Git commitへ入れるため、循環rename・画像欠損・途中失敗でも半端な状態を作らない。
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
  requireCanonicalMasterCards,
  wipCardsPath,
  HttpError,
  type Env,
  type GitFileReference,
  type SetsFile,
} from '../_github';
import {
  CardIdentityError,
  validatePrintingRenames,
} from '../../shared/cardIdentity';

interface Rename {
  from: string;
  to: string;
}

const encodeJson = (value: unknown) =>
  new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

export const onRequestPost: PagesFunction<Env> = (ctx) =>
  handle(async () => {
    const env = ctx.env;
    const { vol, cards: rawCards, renames } = await readJsonBody<{
      vol: number;
      cards: Record<string, unknown>[] | null;
      renames?: Rename[];
    }>(ctx.request);
    if (
      typeof vol !== 'number' ||
      !Number.isInteger(vol) ||
      vol < 1 ||
      !Array.isArray(rawCards) ||
      (renames != null && !Array.isArray(renames))
    ) {
      throw new HttpError(
        400,
        'vol・cards配列と、任意のrenames配列が必要です',
      );
    }
    const cards = requireCanonicalMasterCards(rawCards);
    if (cards.some((card) => card.vol !== vol)) {
      throw new HttpError(
        400,
        'cards には同じ vol のカードだけを入れてください',
      );
    }

    const path = wipCardsPath(vol);
    const [publicSetsFile, wipSetsFile, file, imageDirectory] =
      await Promise.all([
        ghGetJson<SetsFile>(env, PUBLIC_REPO, SETS_PATH),
        ghGetJson<SetsFile>(env, PRIVATE_REPO, WIP_SETS_PATH),
        ghGetJson<Record<string, unknown>[]>(
          env,
          PRIVATE_REPO,
          path,
        ),
        ghListDir(env, PRIVATE_REPO, PRIVATE_IMAGE_DIR),
      ]);
    assertVolEditable(vol, [
      ...(publicSetsFile.data?.sets ?? []),
      ...(wipSetsFile.data?.sets ?? []),
    ]);
    const current = requireCanonicalMasterCards(
      normalizeMasterCards(file.data ?? []),
    );
    if (current.some((card) => card.vol !== vol)) {
      throw new HttpError(
        409,
        `cards/vol${vol}.json に別volのカードがあります`,
      );
    }

    const requestedRenames = (renames ?? []) as Rename[];
    // 旧逐次版でJSONだけ確定し、from-only画像の削除だけ残った状態を冪等に回収する。
    if (
      requestedRenames.length > 0 &&
      JSON.stringify(current) === JSON.stringify(cards)
    ) {
      const renameByTarget = new Map(
        requestedRenames.map((rename) => [rename.to, rename.from]),
      );
      const reconstructed = current.map((card) => {
        const from = renameByTarget.get(card.printingId);
        if (!from) return card;
        return {
          ...card,
          printingId: from,
          code: from.split('-')[1],
        };
      });
      let completedRenames: Rename[];
      try {
        completedRenames = validatePrintingRenames(
          reconstructed,
          cards,
          requestedRenames,
          vol,
        );
      } catch (error) {
        if (error instanceof CardIdentityError) {
          throw new HttpError(409, error.message);
        }
        throw error;
      }
      const toIds = new Set(completedRenames.map((rename) => rename.to));
      const expected: Record<string, string | null> = {
        [path]: file.sha,
        [WIP_SETS_PATH]: wipSetsFile.sha,
      };
      const cleanupReferences: GitFileReference[] = [];
      let restoredImages = 0;
      for (const rename of completedRenames) {
        if (toIds.has(rename.from)) continue;
        const sourcePath = privateImagePath(rename.from);
        const targetPath = privateImagePath(rename.to);
        const sourceSha = imageDirectory[`${rename.from}.webp`] ?? null;
        const targetSha = imageDirectory[`${rename.to}.webp`] ?? null;
        expected[sourcePath] = sourceSha;
        expected[targetPath] = targetSha;
        if (!sourceSha) continue;
        if (!targetSha) {
          cleanupReferences.push({ path: targetPath, sha: sourceSha });
          restoredImages++;
        }
        cleanupReferences.push({ path: sourcePath, sha: null });
      }
      if (cleanupReferences.length > 0) {
        await ghCommitFiles(
          env,
          PRIVATE_REPO,
          [],
          `finish reorder cleanup vol${vol}`,
          expected,
          cleanupReferences,
        );
      }
      return json({
        ok: true,
        savedTo: `${PRIVATE_REPO}/${path}`,
        saved: cards.length,
        movedImages: restoredImages,
        cleanupPending: [],
      });
    }

    let list: Rename[];
    try {
      list = validatePrintingRenames(
        current,
        cards,
        requestedRenames,
        vol,
      );
    } catch (error) {
      if (error instanceof CardIdentityError) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }

    const fromIds = new Set(list.map((rename) => rename.from));
    const toIds = new Set(list.map((rename) => rename.to));
    const expected: Record<string, string | null> = {
      [path]: file.sha,
      [WIP_SETS_PATH]: wipSetsFile.sha,
    };
    const desiredImages = new Map<string, string | null>();
    let movedImages = 0;

    for (const rename of list) {
      const sourceSha =
        imageDirectory[`${rename.from}.webp`] ?? null;
      const targetSha =
        imageDirectory[`${rename.to}.webp`] ?? null;
      if (targetSha && !fromIds.has(rename.to)) {
        throw new HttpError(
          409,
          `移動先 ${rename.to} の画像は既に存在します`,
        );
      }
      expected[privateImagePath(rename.from)] = sourceSha;
      expected[privateImagePath(rename.to)] = targetSha;
      // 元画像が欠損している場合は、循環先に残っている旧画像を明示的に削除する。
      desiredImages.set(privateImagePath(rename.to), sourceSha);
      if (sourceSha) movedImages++;
    }
    for (const from of fromIds) {
      if (!toIds.has(from)) {
        desiredImages.set(privateImagePath(from), null);
      }
    }
    const imageReferences: GitFileReference[] = [...desiredImages].map(
      ([imagePath, sha]) => ({ path: imagePath, sha }),
    );

    await ghCommitFiles(
      env,
      PRIVATE_REPO,
      [{ path, bytes: encodeJson(cards) }],
      `reorder vol${vol} (${cards.length} cards)`,
      expected,
      imageReferences,
    );
    return json({
      ok: true,
      savedTo: `${PRIVATE_REPO}/${path}`,
      saved: cards.length,
      movedImages,
      cleanupPending: [],
    });
  });
