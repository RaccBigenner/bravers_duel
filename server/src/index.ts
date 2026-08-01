import { PROTOCOL_SCAFFOLD } from '@bravers/protocol';

/**
 * OLG-101のworkspace疎通確認用。Worker/MatchDOはまだ起動しない。
 * 実行可能なローカルserverはOLG-102で追加する。
 */
export const SERVER_SCAFFOLD = {
  packageName: '@bravers/server',
  protocolVersion: PROTOCOL_SCAFFOLD.version,
  operational: false,
} as const;
