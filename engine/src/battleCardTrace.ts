import type { PlayerIndex } from './battle';
import type { PrintingId } from './types';

/** バトル中のカードが存在できる配列zone。indexはmutation適用時点の位置。 */
export type BattleCardArrayZone = 'deck' | 'hand' | 'trash' | 'ap';

/**
 * カード個体ledgerが追従するための、engine内の正確な位置。
 * fieldは両プレイヤー共有の1枠なのでplayerを持たない。
 */
export type BattleCardLocation =
  | { type: 'array'; player: PlayerIndex; zone: BattleCardArrayZone; index: number }
  | { type: 'equipment'; player: PlayerIndex; characterSlot: number }
  | { type: 'field' };

/**
 * 1 action中に起きたカード移動。printingIdは表示・定義参照用で、個体IDではない。
 * 同じprintingIdのコピーも位置を使って区別できるよう、move/swapを順番どおり返す。
 */
export type BattleCardMutation =
  | {
      type: 'move';
      printingId: PrintingId;
      from: BattleCardLocation;
      to: BattleCardLocation;
    }
  | {
      type: 'swap';
      player: PlayerIndex;
      zone: 'deck';
      leftIndex: number;
      rightIndex: number;
    };
