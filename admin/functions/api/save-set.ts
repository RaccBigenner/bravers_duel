/**
 * POST /api/save-set  body: { set }
 *
 * 制作中の弾メタだけを非公開リポジトリへ保存する。released/publishingへの変更は
 * publish-set専用で、公開中ロックと同じbranch headをCAS更新して割込みを防ぐ。
 */
import {
  PRIVATE_REPO,
  PUBLIC_REPO,
  SETS_PATH,
  WIP_SETS_PATH,
  assertVolEditable,
  ghCommitFiles,
  ghGetJson,
  handle,
  json,
  readJsonBody,
  HttpError,
  type Env,
  type MasterSet,
  type SetsFile,
} from '../_github';

const encodeJson = (value: unknown) =>
  new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

export const onRequestPost: PagesFunction<Env> = (ctx) =>
  handle(async () => {
    const env = ctx.env;
    const { set } = await readJsonBody<{ set: MasterSet }>(ctx.request);
    if (
      typeof set?.vol !== 'number' ||
      !Number.isInteger(set.vol) ||
      set.vol < 1
    ) {
      throw new HttpError(400, 'set.vol が不正です');
    }

    const [publicFile, wipFile] = await Promise.all([
      ghGetJson<SetsFile>(env, PUBLIC_REPO, SETS_PATH),
      ghGetJson<SetsFile>(env, PRIVATE_REPO, WIP_SETS_PATH),
    ]);
    assertVolEditable(set.vol, [
      ...(publicFile.data?.sets ?? []),
      ...(wipFile.data?.sets ?? []),
    ]);
    if (set.status === 'released' || set.status === 'publishing') {
      throw new HttpError(
        403,
        '弾の公開状態は直接変更できません。「弾を公開」を使ってください。',
      );
    }

    const base: SetsFile = wipFile.data ?? { sets: [] };
    const sets = (base.sets ?? []).filter(
      (existing) => existing.vol !== set.vol,
    );
    sets.push(set);
    sets.sort((a, b) => a.vol - b.vol);
    await ghCommitFiles(
      env,
      PRIVATE_REPO,
      [
        {
          path: WIP_SETS_PATH,
          bytes: encodeJson({ ...base, sets }),
        },
      ],
      `save set vol${set.vol}`,
      { [WIP_SETS_PATH]: wipFile.sha },
    );
    return json({
      ok: true,
      savedTo: `${PRIVATE_REPO}/${WIP_SETS_PATH}`,
    });
  });
