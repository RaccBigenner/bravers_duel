/**
 * POST /api/publish-set  body: { vol }
 *
 * Cloudflare Free上では画像を読み書きしない。カード・弾・効果・test・画像SHAを検査して
 * 非公開リポをpublishingへロックし、重い検証・画像コピー・公開commitは
 * 非公開リポのGitHub Actionsへ委譲する。
 *
 * active manifestとrequestIdが公開処理の冪等キーになる。同じ弾を再実行した時は
 * 新しいスナップショットを作らず、同じoperationを再dispatchする。
 */
import {
  CARDS_PATH,
  PRIVATE_IMAGE_DIR,
  PRIVATE_REPO,
  PUBLIC_IMAGE_DIR,
  PUBLIC_REPO,
  PUBLISH_ACTIVE_PATH,
  PUBLISH_WORKFLOW,
  SETS_PATH,
  WIP_SETS_PATH,
  ghCommitFiles,
  ghDispatchWorkflow,
  ghFindWorkflowRun,
  ghGetJson,
  ghGetSha,
  ghListDir,
  handle,
  json,
  normalizeMasterCards,
  privateImagePath,
  readJsonBody,
  requireCanonicalMasterCards,
  requireNoOracleGameplayDrifts,
  requireResolvedOracleIds,
  wipCardsPath,
  wipEffectTestsPath,
  wipEffectsPath,
  HttpError,
  type Env,
  type MasterCard,
  type PublishManifest,
  type SetsFile,
} from '../_github';

const REQUEST_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA1_RE = /^[0-9a-f]{40}$/;

const encodeJson = (value: unknown) =>
  new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

export function isPublishManifest(value: unknown): value is PublishManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<PublishManifest>;
  const set =
    manifest.set && typeof manifest.set === 'object'
      ? manifest.set
      : null;
  const imageEntries =
    manifest.imageShas &&
    typeof manifest.imageShas === 'object' &&
    !Array.isArray(manifest.imageShas)
      ? Object.entries(manifest.imageShas)
      : [];
  return (
    manifest.schemaVersion === 3 &&
    Number.isInteger(manifest.vol) &&
    manifest.vol! > 0 &&
    typeof manifest.requestId === 'string' &&
    REQUEST_ID_RE.test(manifest.requestId) &&
    !!set &&
    set.vol === manifest.vol &&
    set.status === 'publishing' &&
    set.publishOperationId === manifest.requestId &&
    typeof manifest.cardsSha === 'string' &&
    SHA1_RE.test(manifest.cardsSha) &&
    typeof manifest.effectsSha === 'string' &&
    SHA1_RE.test(manifest.effectsSha) &&
    typeof manifest.effectTestsSha === 'string' &&
    SHA1_RE.test(manifest.effectTestsSha) &&
    Number.isInteger(manifest.cardCount) &&
    manifest.cardCount! > 0 &&
    imageEntries.length === manifest.cardCount &&
    imageEntries.every(
      ([printingId, sha]) =>
        printingId.trim() !== '' &&
        typeof sha === 'string' &&
        SHA1_RE.test(sha),
    ) &&
    typeof manifest.createdAt === 'string' &&
    Number.isFinite(Date.parse(manifest.createdAt))
  );
}

export const onRequestPost: PagesFunction<Env> = (ctx) =>
  handle(async () => {
    const env = ctx.env;
    const { vol } = await readJsonBody<{ vol: number }>(ctx.request);
    if (
      typeof vol !== 'number' ||
      !Number.isInteger(vol) ||
      vol < 1
    ) {
      throw new HttpError(400, 'volが不正です');
    }

    const wipPath = wipCardsPath(vol);
    const [
      activeFile,
      wipSetsFile,
      publicSetsFile,
      wipFile,
      publicCardsFile,
    ] = await Promise.all([
      ghGetJson<unknown>(env, PRIVATE_REPO, PUBLISH_ACTIVE_PATH),
      ghGetJson<SetsFile>(env, PRIVATE_REPO, WIP_SETS_PATH),
      ghGetJson<SetsFile>(env, PUBLIC_REPO, SETS_PATH),
      ghGetJson<Record<string, unknown>[]>(env, PRIVATE_REPO, wipPath),
      ghGetJson<Record<string, unknown>[]>(env, PUBLIC_REPO, CARDS_PATH),
    ]);

    const publicSets = publicSetsFile.data?.sets ?? [];
    const alreadyReleased =
      publicSets.find((set) => set.vol === vol)?.status === 'released';
    const wipSets = wipSetsFile.data?.sets ?? [];
    const sourceSet = wipSets.find((set) => set.vol === vol);

    let manifest: PublishManifest;
    if (activeFile.data != null) {
      if (!isPublishManifest(activeFile.data)) {
        throw new HttpError(
          409,
          '公開処理の管理ファイルが不正です。リポジトリを確認してください',
        );
      }
      manifest = activeFile.data;
      if (manifest.vol !== vol) {
        throw new HttpError(
          409,
          `第${manifest.vol}弾の公開処理が進行中です。完了してから第${vol}弾を公開してください`,
        );
      }
      if (
        !sourceSet ||
        sourceSet.status !== 'publishing' ||
        sourceSet.publishOperationId !== manifest.requestId
      ) {
        throw new HttpError(
          409,
          '公開処理のロックと管理ファイルが一致しません。リポジトリを確認してください',
        );
      }
    } else {
      if (alreadyReleased && !sourceSet) {
        return json({
          ok: true,
          status: 'complete',
          alreadyReleased: true,
          cardCount: 0,
        });
      }
      if (!sourceSet) {
        throw new HttpError(404, `vol${vol} の制作中弾が見つかりません`);
      }
      if (sourceSet.status === 'publishing') {
        throw new HttpError(
          409,
          '公開中ロックだけが残っています。active manifestを確認してください',
        );
      }
      if (alreadyReleased) {
        throw new HttpError(
          409,
          `vol${vol} は公開済みですが制作中データが残っています。自動削除せず停止しました`,
        );
      }

      const wipCards = normalizeMasterCards(wipFile.data ?? []);
      if (wipCards.length === 0) {
        throw new HttpError(409, `vol${vol} に公開するWIPカードがありません`);
      }
      const promoted: MasterCard[] = wipCards.map((card) => {
        if (card.status !== 'draft') return card;
        const { status: _drop, ...rest } = card;
        return rest as MasterCard;
      });
      const canonicalPromoted = requireCanonicalMasterCards(promoted);
      if (canonicalPromoted.some((card) => card.vol !== vol)) {
        throw new HttpError(
          409,
          `cards/vol${vol}.json に別volのカードがあります。公開前に修正してください`,
        );
      }

      const canonicalPublic = requireCanonicalMasterCards(
        normalizeMasterCards(publicCardsFile.data ?? []),
      );
      const publicByPrintingId = new Map(
        canonicalPublic.map((card) => [card.printingId, card]),
      );
      const collisions = canonicalPromoted
        .filter((card) => publicByPrintingId.has(card.printingId))
        .map((card) => card.printingId);
      if (collisions.length > 0) {
        throw new HttpError(
          409,
          `公開側とPrinting IDが衝突しています: ${collisions.join('、')}`,
        );
      }
      const combined = requireCanonicalMasterCards([
        ...canonicalPublic,
        ...canonicalPromoted,
      ]);
      requireResolvedOracleIds(combined);
      requireNoOracleGameplayDrifts(combined);

      const effectsPath = wipEffectsPath(vol);
      const effectTestsPath = wipEffectTestsPath(vol);
      const [
        wipImages,
        publicImages,
        effectsSha,
        effectTestsSha,
      ] = await Promise.all([
        ghListDir(env, PRIVATE_REPO, PRIVATE_IMAGE_DIR),
        ghListDir(env, PUBLIC_REPO, PUBLIC_IMAGE_DIR),
        ghGetSha(env, PRIVATE_REPO, effectsPath),
        ghGetSha(env, PRIVATE_REPO, effectTestsPath),
      ]);
      if (!effectsSha) {
        throw new HttpError(
          409,
          `effects/vol${vol}.ts がありません。効果なしの弾でも空のVOL${vol}_EFFECTSを用意してください`,
        );
      }
      if (!effectTestsSha) {
        throw new HttpError(
          409,
          `effects/vol${vol}.test.ts がありません。弾固有の効果回帰テストを用意してください`,
        );
      }
      const missingImages = canonicalPromoted
        .filter((card) => !wipImages[`${card.printingId}.webp`])
        .map((card) => card.printingId);
      if (missingImages.length > 0) {
        throw new HttpError(
          409,
          `画像が無いため公開できません: ${missingImages.join('、')}`,
        );
      }
      const publicImageCollisions = canonicalPromoted
        .filter((card) => publicImages[`${card.printingId}.webp`])
        .map((card) => card.printingId);
      if (publicImageCollisions.length > 0) {
        throw new HttpError(
          409,
          `公開側に同名画像があります: ${publicImageCollisions.join('、')}`,
        );
      }
      if (!wipFile.sha) {
        throw new HttpError(409, 'WIPカードのGit SHAを取得できませんでした');
      }

      const requestId = crypto.randomUUID();
      const lockedSet = {
        ...sourceSet,
        status: 'publishing',
        publishOperationId: requestId,
      };
      const lockedSets: SetsFile = {
        ...(wipSetsFile.data ?? { sets: [] }),
        sets: wipSets.map((set) =>
          set.vol === vol ? lockedSet : set,
        ),
      };
      const imageShas = Object.fromEntries(
        canonicalPromoted.map((card) => [
          card.printingId,
          wipImages[`${card.printingId}.webp`],
        ]),
      );
      manifest = {
        schemaVersion: 3,
        vol,
        requestId,
        set: lockedSet,
        cardsSha: wipFile.sha,
        effectsSha,
        effectTestsSha,
        imageShas,
        cardCount: canonicalPromoted.length,
        createdAt: new Date().toISOString(),
      };

      await ghCommitFiles(
        env,
        PRIVATE_REPO,
        [
          { path: WIP_SETS_PATH, bytes: encodeJson(lockedSets) },
          { path: PUBLISH_ACTIVE_PATH, bytes: encodeJson(manifest) },
        ],
        `lock vol${vol} for publish ${requestId}`,
        {
          [WIP_SETS_PATH]: wipSetsFile.sha,
          [wipPath]: wipFile.sha,
          [effectsPath]: effectsSha,
          [effectTestsPath]: effectTestsSha,
          [PUBLISH_ACTIVE_PATH]: null,
          ...Object.fromEntries(
            canonicalPromoted.map((card) => [
              privateImagePath(card.printingId),
              wipImages[`${card.printingId}.webp`],
            ]),
          ),
        },
      );
    }

    const displayTitle =
      `Publish card set vol${vol} (${manifest.requestId})`;
    const currentRun = await ghFindWorkflowRun(
      env,
      PRIVATE_REPO,
      PUBLISH_WORKFLOW,
      displayTitle,
    );
    if (currentRun && currentRun.status !== 'completed') {
      return json(
        {
          ok: true,
          status: 'queued',
          requestId: manifest.requestId,
          runId: currentRun.id,
          runUrl: currentRun.htmlUrl,
          cardCount: manifest.cardCount,
          alreadyReleased,
        },
        202,
      );
    }

    const run = await ghDispatchWorkflow(
      env,
      PRIVATE_REPO,
      PUBLISH_WORKFLOW,
      {
        vol: String(vol),
        request_id: manifest.requestId,
      },
    );
    return json(
      {
        ok: true,
        status: 'queued',
        requestId: manifest.requestId,
        runId: run.workflowRunId,
        runUrl: run.htmlUrl,
        cardCount: manifest.cardCount,
        alreadyReleased,
      },
      202,
    );
  });
