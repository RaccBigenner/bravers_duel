/**
 * GET /api/publish-status?vol=N&runId=ID&requestId=UUID
 *
 * GitHub Actionsの状態、公開弾、非公開ロックを合成して管理画面向けの状態へする。
 * workflowログ本文や未公開データは返さない。
 */
import {
  PRIVATE_REPO,
  PUBLIC_REPO,
  PUBLISH_ACTIVE_PATH,
  SETS_PATH,
  WIP_SETS_PATH,
  PUBLISH_WORKFLOW,
  ghFindWorkflowRun,
  ghGetJson,
  ghGetWorkflowRun,
  handle,
  json,
  HttpError,
  type Env,
  type PublishManifest,
  type SetsFile,
} from '../_github';

const REQUEST_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const onRequestGet: PagesFunction<Env> = (ctx) =>
  handle(async () => {
    const url = new URL(ctx.request.url);
    const vol = Number(url.searchParams.get('vol'));
    const runId = Number(url.searchParams.get('runId'));
    const requestId = url.searchParams.get('requestId') ?? '';
    if (
      !Number.isInteger(vol) ||
      vol < 1 ||
      !Number.isInteger(runId) ||
      runId < 1 ||
      !REQUEST_ID_RE.test(requestId)
    ) {
      throw new HttpError(400, '公開状態の照会パラメータが不正です');
    }

    const [publicSetsFile, wipSetsFile, activeFile] = await Promise.all([
      ghGetJson<SetsFile>(ctx.env, PUBLIC_REPO, SETS_PATH),
      ghGetJson<SetsFile>(ctx.env, PRIVATE_REPO, WIP_SETS_PATH),
      ghGetJson<PublishManifest>(
        ctx.env,
        PRIVATE_REPO,
        PUBLISH_ACTIVE_PATH,
      ),
    ]);
    const active = activeFile.data;
    const released =
      (publicSetsFile.data?.sets ?? []).find((set) => set.vol === vol)
        ?.status === 'released';
    const wipSet = (wipSetsFile.data?.sets ?? []).find(
      (set) => set.vol === vol,
    );

    if (
      released &&
      !wipSet &&
      (!active || active.vol !== vol)
    ) {
      return json({
        status: 'complete',
        retryable: false,
      });
    }
    if (
      active &&
      (active.vol !== vol || active.requestId !== requestId)
    ) {
      throw new HttpError(
        409,
        '別の公開処理が開始されています。管理画面を再読み込みしてください',
      );
    }

    const requestedRun = await ghGetWorkflowRun(
      ctx.env,
      PRIVATE_REPO,
      runId,
    );
    const latestRun = active
      ? await ghFindWorkflowRun(
          ctx.env,
          PRIVATE_REPO,
          PUBLISH_WORKFLOW,
          `Publish card set vol${vol} (${requestId})`,
        )
      : null;
    const run =
      latestRun && latestRun.id > requestedRun.id
        ? latestRun
        : requestedRun;
    if (run.status !== 'completed') {
      return json({
        status:
          run.status === 'in_progress' ? 'running' : 'queued',
        retryable: false,
        runUrl: run.htmlUrl,
      });
    }
    if (run.conclusion === 'success') {
      return json({
        status: released ? 'cleanup_pending' : 'failed_retryable',
        retryable: true,
        runUrl: run.htmlUrl,
      });
    }

    return json({
      status:
        !active && (!wipSet || wipSet.status !== 'publishing')
          ? 'failed_unlocked'
          : 'failed_retryable',
      retryable: true,
      runUrl: run.htmlUrl,
    });
  });
