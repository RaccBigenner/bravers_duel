/**
 * カードデザイン用の素材マッピング（旧プロトタイプの card_widget.dart を移植）
 */
import type { Rarity } from '@bravers/engine';

export const IMG = (name: string) => `${import.meta.env.BASE_URL}card_images/${name}.webp`;
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

/** スキルの値プレート（左: 種類ラベル / 右: 数値） */
export function skillPlate(rarity: Rarity, side: 'left' | 'right'): string {
  const grade = rarity === 'C' ? 'normal' : rarity === 'R' ? 'silver' : 'gold';
  return IMG(`skill_value_${side}_${grade}`);
}

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
