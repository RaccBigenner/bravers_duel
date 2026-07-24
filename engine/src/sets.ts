/**
 * 弾（セット）マスタの読み込みと検証。
 * データ本体は data/sets.json。カードは vol でこの弾に属する。
 *
 * 公開の要は「status:'released' の弾のカードだけを ALL_CARDS に入れる」こと。
 * 判定は cards.ts が isVolReleased() を使って行う。
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

/** 全ての弾（draft も含む。data/sets.json に書かれたぶん全部） */
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
