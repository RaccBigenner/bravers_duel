/**
 * OLG-101ではworkspaceの解決だけを検証する。
 * Command/Event/Snapshotの実型は、engine adapterと冪等command処理を作る
 * OLG-121/122で正本と同時に追加する。
 */
export const PROTOCOL_SCAFFOLD = {
  version: 'OLG-101',
  operational: false,
} as const;

export type ProtocolScaffold = typeof PROTOCOL_SCAFFOLD;
