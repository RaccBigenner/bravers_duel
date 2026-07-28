/**
 * POST /api/save-set  body: { set }
 * 弾（セット）を追加・更新する。
 *
 * 保存先は status で決める（カードと同じ考え方）:
 * - status:'released' … 公開リポ data/sets.json
 * - それ以外（制作中） … 非公開リポ sets.wip.json
 *
 * 公開リポの data/sets.json は丸ごとブラウザに配信されるので、制作中の弾の
 * テーマ名・サブタイトルをそこへ書くと必ず外から読める。だから振り分けは
 * 「保存の時点」で行い、反対側に残った同 vol は消す（行き来しても二重化しない）。
 * レスポンス: { ok:true, savedTo }
 */
import {
  assertVolEditable,
  PRIVATE_REPO,
  PUBLIC_REPO,
  SETS_PATH,
  WIP_SETS_PATH,
  ghGetJson,
  ghPutJson,
  handle,
  json,
  readJsonBody,
  HttpError,
  type Env,
  type MasterSet,
  type SetsFile,
} from '../_github';

export const onRequestPost: PagesFunction<Env> = (ctx) =>
  handle(async () => {
    const env = ctx.env;
    const { set } = await readJsonBody<{ set: MasterSet }>(ctx.request);
    if (typeof set?.vol !== 'number') {
      throw new HttpError(400, 'set.vol が必要です');
    }

    // 公開済みの弾のメタ情報（テーマ名・公開日など）も変更させない
    const current = (await ghGetJson<SetsFile>(env, PUBLIC_REPO, SETS_PATH)).data?.sets ?? [];
    assertVolEditable(set.vol, current);
    // 「状態」を手で released にして公開状態を作ることも認めない。
    // 公開は publish-set（カードと画像を移してから最後に released にする）だけの仕事。
    if (set.status === 'released') {
      throw new HttpError(403, '弾を公開するには「弾を公開」を使ってください（状態を直接 released にはできません）。');
    }

    // ここを通る時点で必ず制作中なので isPublic は常に false。
    // save-card と同じく、置き場所の規則と書いてよいかの判断は分けて持つ。
    const isPublic = set.status === 'released';
    const target = isPublic
      ? ({ repo: PUBLIC_REPO, path: SETS_PATH } as const)
      : ({ repo: PRIVATE_REPO, path: WIP_SETS_PATH } as const);
    const other = isPublic
      ? ({ repo: PRIVATE_REPO, path: WIP_SETS_PATH } as const)
      : ({ repo: PUBLIC_REPO, path: SETS_PATH } as const);

    // 保存先: 同 vol を差し替え / 追加して vol 昇順で書き戻す（_comment などは保つ）
    const file = await ghGetJson<SetsFile>(env, target.repo, target.path);
    const base: SetsFile = file.data ?? { sets: [] };
    const sets = (base.sets ?? []).filter((s) => s.vol !== set.vol);
    sets.push(set);
    sets.sort((a, b) => a.vol - b.vol);
    await ghPutJson(env, target.repo, target.path, { ...base, sets }, `save set vol${set.vol}`, file.sha);

    // 反対側に同 vol が残っていたら消す（変化がある時だけ書く）
    const otherFile = await ghGetJson<SetsFile>(env, other.repo, other.path);
    const otherBase = otherFile.data;
    if (otherBase) {
      const pruned = (otherBase.sets ?? []).filter((s) => s.vol !== set.vol);
      if (pruned.length !== (otherBase.sets ?? []).length) {
        await ghPutJson(
          env,
          other.repo,
          other.path,
          { ...otherBase, sets: pruned },
          `save set vol${set.vol}: remove from ${other.path}`,
          otherFile.sha,
        );
      }
    }

    return json({ ok: true, savedTo: `${target.repo}/${target.path}` });
  });
