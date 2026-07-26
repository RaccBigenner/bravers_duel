/**
 * 弾（セット）マスタの読み込みと検証。
 * データ本体は data/sets.json。カードは vol でこの弾に属する。
 *
 * 公開の要は「status:'released' の弾のカードだけを ALL_CARDS に入れる」こと。
 * 判定は cards.ts が isVolReleased() を使って行う。
 *
 * ⚠️ data/sets.json には **公開済みの弾しか書かない**（2026-07-25 以降）。
 * この import はJSONを丸ごとバンドルに埋め込むので、ファイルに書いた文字列は
 * 使っていなくても公開ビルドに入り、開発者ツールから必ず読める。
 * 実際に第2弾のサブタイトルが公開JSに入っていた。制作中の弾のメタ情報は
 * data/wip/sets.json（gitignore）／非公開リポの sets.wip.json 側に置くこと。
 * 破ると engine/test/sets.test.ts と scripts/check-no-wip-leak.mjs が落ちる。
 */
import rawSets from '../../data/sets.json';
import { CARD_STATUSES, PACK_TYPES, type SetMeta } from './types';

function failSet(vol: unknown, message: string): never {
  throw new Error(`弾データが不正です [vol=${vol}]: ${message}`);
}

function validateSet(raw: Record<string, unknown>): SetMeta {
  const vol = raw.vol;
  if (typeof vol !== 'number') failSet(vol, 'vol が数値ではない');
  if (typeof raw.themeNo !== 'number') failSet(vol, 'themeNo が数値ではない');
  if (typeof raw.themeName !== 'string') failSet(vol, 'themeName が文字列ではない');
  if (typeof raw.themeSubtitle !== 'string') failSet(vol, 'themeSubtitle が文字列ではない');
  if (!PACK_TYPES.includes(raw.packType as never)) failSet(vol, `未知の packType: ${raw.packType}`);
  if (!CARD_STATUSES.includes(raw.status as never)) failSet(vol, `未知の status: ${raw.status}`);
  if (typeof raw.releasedAt !== 'string') failSet(vol, 'releasedAt が文字列ではない');
  return {
    vol,
    themeNo: raw.themeNo,
    themeName: raw.themeName,
    themeSubtitle: raw.themeSubtitle,
    packType: raw.packType as SetMeta['packType'],
    status: raw.status as SetMeta['status'],
    releasedAt: raw.releasedAt,
    codename: typeof raw.codename === 'string' ? raw.codename : undefined,
  };
}

/** data/sets.json に書かれた弾。運用上ここに入るのは公開済みの弾だけ（上の注意書き参照） */
export const ALL_SETS: SetMeta[] = ((rawSets as { sets?: unknown }).sets as Record<string, unknown>[] ?? []).map(
  validateSet,
);

const setByVol = new Map(ALL_SETS.map((s) => [s.vol, s]));

export function setOfVol(vol: number): SetMeta | undefined {
  return setByVol.get(vol);
}

/** その弾が公開済みか（存在しない弾は未公開扱い） */
export function isVolReleased(vol: number): boolean {
  return setByVol.get(vol)?.status === 'released';
}

/** 公開済みの弾だけ */
export const RELEASED_SETS: SetMeta[] = ALL_SETS.filter((s) => s.status === 'released');
