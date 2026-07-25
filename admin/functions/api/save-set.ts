/**
 * POST /api/save-set  body: { set }
 * 弾（セット）を追加・更新する。
 * 公開リポ data/sets.json の sets 配列で同 vol を差し替え / 追加し、vol 昇順で書き戻す。
 * （_comment などトップレベルの付随フィールドは保つ）
 * レスポンス: { ok:true }
 */
import {
  PUBLIC_REPO,
  SETS_PATH,
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

    const file = await ghGetJson<SetsFile>(env, PUBLIC_REPO, SETS_PATH);
    const base: SetsFile = file.data ?? { sets: [] };
    const sets = base.sets ?? [];

    const idx = sets.findIndex((s) => s.vol === set.vol);
    if (idx >= 0) sets[idx] = set;
    else sets.push(set);
    sets.sort((a, b) => a.vol - b.vol);

    await ghPutJson(env, PUBLIC_REPO, SETS_PATH, { ...base, sets }, `save set vol${set.vol}`, file.sha);

    return json({ ok: true });
  });
