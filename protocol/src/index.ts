/**
 * OLG-101で作った共有protocolの入口。
 * OLG-123ではカードを指すactionだけを先に固定する。command envelope / Event / Snapshotと
 * 実際のbrowser wireはOLG-122/124まで閉じたままにする。
 */
export const PROTOCOL_SCAFFOLD = {
  version: 'OLG-101',
  operational: false,
} as const;

export type ProtocolScaffold = typeof PROTOCOL_SCAFFOLD;

/**
 * 1試合の中だけで有効なカード個体ID。globalな所持instance IDとは別物。
 * 実値はserverが試合ごとに128-bit乱数から生成し、clientはopaque値として扱う。
 */
declare const battleCardIdBrand: unique symbol;
export type BattleCardId = `bc_${string}` & { readonly [battleCardIdBrand]: true };

export const BATTLE_CARD_ID_PATTERN = /^bc_[0-9a-f]{32}$/;

/** trust boundaryでopaque IDの形式だけを検証する。所有・zone・生存期間はserver台帳で検証する。 */
export function parseBattleCardId(value: unknown): BattleCardId | null {
  return typeof value === 'string' && BATTLE_CARD_ID_PATTERN.test(value)
    ? (value as BattleCardId)
    : null;
}

/** OLG-123で固定するaction種別。transportを開くのは後続OLG。 */
export const MATCH_ACTION_TYPES = [
  'playSkill',
  'playCharacter',
  'playEquipment',
  'playField',
  'turnStartAbility',
  'skipTurnStart',
  'endPlay',
  'playGuard',
  'pass',
  'charge',
  'endTurn',
] as const;

export type MatchActionType = (typeof MATCH_ACTION_TYPES)[number];

/**
 * clientが送る行動意図。手札位置は信用せずbattleCardIdからserverが現在位置を引く。
 * numberの整数・範囲と枝ごとのexact schemaはserver境界で検証する。
 */
export type MatchAction =
  | {
      type: 'playSkill';
      battleCardId: BattleCardId;
      healTargetSlot?: number;
      targetSlot?: number;
      usingCharacterSlot?: number;
    }
  | { type: 'playCharacter'; battleCardId: BattleCardId }
  | { type: 'playEquipment'; battleCardId: BattleCardId; targetCharacterSlot: number }
  | { type: 'playField'; battleCardId: BattleCardId }
  | { type: 'turnStartAbility'; characterSlot: number }
  | { type: 'skipTurnStart' }
  | { type: 'endPlay' }
  | { type: 'playGuard'; battleCardId: BattleCardId }
  | { type: 'pass' }
  | { type: 'charge'; battleCardId: BattleCardId }
  | { type: 'endTurn' };
