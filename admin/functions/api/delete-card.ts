/**
 * POST /api/delete-card  body: { printingId, vol }
 *
 * WIPカードと画像を非公開リポジトリの同一Git commitで削除する。
 * 公開カードは拒否し、既にカードだけ削除済みなら孤立画像の後片付けとして冪等に動く。
 */
import {
  CARDS_PATH,
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
  type SetsFile,
} from '../_github';

const encodeJson = (value: unknown) =>
  new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

export const onRequestPost: PagesFunction<Env> = (ctx) =>
  handle(async () => {
    const env = ctx.env;
    const {
      printingId: rawPrintingId,
      id: legacyId,
      vol,
    } = await readJsonBody<{
      printingId?: string;
      id?: string;
      vol: number;
    }>(ctx.request);
    const printingId = rawPrintingId ?? legacyId;
    if (
      !printingId ||
      typeof vol !== 'number' ||
      !Number.isInteger(vol) ||
      vol < 1 ||
      !new RegExp(
        `^${vol}-A\\d{3}-(?:C|UC|R|SR|SSR|USR|LSR)$`,
      ).test(printingId)
    ) {
      throw new HttpError(400, 'printingId と vol が不正です');
    }

    const path = wipCardsPath(vol);
    const [
      publicSetsFile,
      wipSetsFile,
      published,
      file,
      imageDirectory,
    ] = await Promise.all([
      ghGetJson<SetsFile>(env, PUBLIC_REPO, SETS_PATH),
      ghGetJson<SetsFile>(env, PRIVATE_REPO, WIP_SETS_PATH),
      ghGetJson<Record<string, unknown>[]>(
        env,
        PUBLIC_REPO,
        CARDS_PATH,
      ),
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
    if (
      normalizeMasterCards(published.data ?? []).some(
        (card) => card.printingId === printingId,
      )
    ) {
      throw new HttpError(
        403,
        `${printingId} は公開済みです。管理画面からは削除できません`,
      );
    }

    const cards = normalizeMasterCards(file.data ?? []);
    const target = cards.find(
      (card) => card.printingId === printingId,
    );
    if (target && target.vol !== vol) {
      throw new HttpError(
        409,
        `${printingId} の保存volとリクエストvolが一致しません`,
      );
    }

    const imagePath = privateImagePath(printingId);
    const imageSha = imageDirectory[`${printingId}.webp`] ?? null;
    if (!target && !imageSha) {
      return json({
        ok: true,
        cleanupPending: false,
        alreadyDeleted: true,
      });
    }

    const changes = target
      ? [
          {
            path,
            bytes: encodeJson(
              requireCanonicalMasterCards(
                cards.filter(
                  (card) => card.printingId !== printingId,
                ),
              ),
            ),
          },
        ]
      : [];
    await ghCommitFiles(
      env,
      PRIVATE_REPO,
      changes,
      `delete card ${printingId}`,
      {
        [WIP_SETS_PATH]: wipSetsFile.sha,
        ...(target ? { [path]: file.sha } : {}),
        [imagePath]: imageSha,
      },
      imageSha ? [{ path: imagePath, sha: null }] : [],
    );
    return json({
      ok: true,
      cleanupPending: false,
      alreadyDeleted: !target,
    });
  });
