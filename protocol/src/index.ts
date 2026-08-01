/**
 * OLG-101ではworkspaceの解決だけを検証する。
 * OLG-121の権威engine型はserver内部に閉じる。browser向けCommand/Event/Snapshotは、
 * stable card ID・command envelope・player projectionを作るOLG-123/122/124で追加する。
 */
export const PROTOCOL_SCAFFOLD = {
  version: 'OLG-101',
  operational: false,
} as const;

export type ProtocolScaffold = typeof PROTOCOL_SCAFFOLD;
