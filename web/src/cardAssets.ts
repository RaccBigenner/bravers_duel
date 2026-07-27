/**
 * カードデザイン用の素材マッピング（旧プロトタイプの card_widget.dart を移植）
 */
import type { Card, Rarity } from '@bravers/engine';
import kiraTexture from './assets/kira_diamond.webp';

/**
 * カード画像の版番号（管理画面だけが設定する）。
 * 管理画面は画像を差し替えるので、URL に版番号を付けて
 * 「変わった時だけ取り直す」ようにしないと一覧が重い。
 * ゲーム側は設定しないので、これまで通りのURLになる。
 */
let imageRevisions: Record<string, string> = {};
export function setImageRevisions(map: Record<string, string>): void {
  imageRevisions = map;
}

export const IMG = (name: string) => {
  const rev = imageRevisions[name];
  return `${import.meta.env.BASE_URL}card_images/${name}.webp${rev ? `?v=${rev}` : ''}`;
};
/** AI生成し直した透過PNGのアイコン素材（ハート・ダイヤなど） */
export const IMG_PNG = (name: string) => `${import.meta.env.BASE_URL}card_images/${name}.png`;

/** レアリティ → 外枠の背景画像 */
export function frameImage(rarity: Rarity): string {
  switch (rarity) {
    case 'LSR': return IMG('background_frame_diamond');
    case 'USR': return IMG('background_frame_wave');
    case 'SSR': return IMG('background_frame_black');
    case 'SR': return IMG('background_frame_gold');
    case 'R': return IMG('background_frame_metal');
    case 'UC': return IMG('background_frame_ripple');
    default: return IMG('background_frame_ripple');
  }
}

/** レアリティ → 内側の背景画像（高レアは画像が全面に出るので無し） */
export function innerImage(rarity: Rarity): string | null {
  switch (rarity) {
    case 'C': return IMG('inner_background_grey');
    case 'UC': return IMG('inner_background_darkgrey');
    case 'R': return IMG('inner_background_red');
    case 'SR': return IMG('inner_background_emerald');
    default: return null;
  }
}

/** レアリティ → 画像フレームのグラデーション（CSS） */
export function rarityGradient(rarity: Rarity): string | null {
  switch (rarity) {
    case 'C':
      return 'linear-gradient(135deg, #eeeeee, #f8f8f8, #dcdcdc)';
    case 'R':
      return 'linear-gradient(135deg, #D9D9D9, #BFBFBF, #EEEEEE)';
    case 'SR':
      return 'linear-gradient(135deg, #FFF8DC, #FFD700, #FFE135)';
    case 'USR':
      return 'linear-gradient(135deg, red, orange, yellow, green, blue, indigo, purple)';
    default:
      return null;
  }
}

/** スキルの値プレート（AI生成の新素材。C=通常 / UC・R=銀 / それ以上=金） */
export function skillPlate(rarity: Rarity): string {
  const grade = rarity === 'C' ? 'normal' : rarity === 'UC' || rarity === 'R' ? 'silver' : 'gold';
  return IMG_PNG(`plate_${grade}`);
}

/** フィールドカードのタイトル帯（AI生成の新素材。R=銀 / SR=金） */
export function fieldTitlePlate(rarity: Rarity): string {
  return IMG_PNG(rarity === 'R' ? 'field_title_silver' : 'field_title_gold');
}

/** 数字・英字ラベル用フォント（ファンタジー調） */
export const NUM_FONT = "'Cinzel', 'Murecho', serif";
/** フレーバーテキスト用フォント */
export const FLAVOR_FONT = "'Shippori Mincho', serif";

export function valueTypeLabel(valueType: string): string {
  switch (valueType) {
    case 'attack': return 'ATTACK';
    case 'guard': return 'GUARD';
    case 'heal': return 'HEAL';
    default: return 'SUPPORT';
  }
}

/** 画像が全面に敷かれるレアリティ（キャラクター用） */
export function isFullArt(rarity: Rarity): boolean {
  return rarity === 'USR' || rarity === 'SSR' || rarity === 'LSR';
}

// ---- キラ（ホロ）加工 ------------------------------------------------------

/**
 * 第1弾の USR は、キラのテクスチャが**カード絵そのものに描き込まれている**
 * （`assets/card_images/1-A003-USR.webp` 等。別レイヤーではない）。
 * 第2弾以降は絵に描き込まず、ここで1枚のテクスチャを重ねて出す。
 * こうするとカードごとの質感のばらつきが無くなり、後から強さも一括で変えられる。
 *
 * **第1弾に掛けると二重掛けになる**ので、vol で必ず切り分けること。
 */
const KIRA_FROM_VOL = 2;

/**
 * キラを掛けるレアリティ。
 * LSR は枠そのものがこの絵柄なので掛けない。SSR は社長判断で対象外（2026-07-26）。
 */
const KIRA_RARITIES: readonly Rarity[] = ['USR'];

/**
 * そのカードに重ねるキラのテクスチャ。掛けないカードは null。
 * 種類（キャラ／スキル／装備／フィールド）は問わず、レアリティだけで決まる。
 */
export function kiraOverlay(card: Pick<Card, 'rarity'> & { vol: number }): string | null {
  if (card.vol < KIRA_FROM_VOL) return null; // 第1弾は絵に焼き込み済み
  return KIRA_RARITIES.includes(card.rarity) ? kiraTexture : null;
}
