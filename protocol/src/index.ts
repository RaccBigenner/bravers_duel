/**
 * OLG-101で作った共有protocolの入口。
 * OLG-123でカードを指すaction、OLG-122でcommand envelope / receiptを固定する。
 * Event / Snapshotと実際のbrowser wireはOLG-125/124まで閉じたままにする。
 */
export const PROTOCOL_SCAFFOLD = {
  version: 'OLG-101',
  operational: false,
} as const;

export type ProtocolScaffold = typeof PROTOCOL_SCAFFOLD;

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.includes(key))
  );
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/**
 * 1試合の中だけで有効なカード個体ID。globalな所持instance IDとは別物。
 * 実値はserverが試合ごとに128-bit乱数から生成し、clientはopaque値として扱う。
 */
declare const battleCardIdBrand: unique symbol;
export type BattleCardId = `bc_${string}` & {
  readonly [battleCardIdBrand]: true;
};

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
  | {
      type: 'playEquipment';
      battleCardId: BattleCardId;
      targetCharacterSlot: number;
    }
  | { type: 'playField'; battleCardId: BattleCardId }
  | { type: 'turnStartAbility'; characterSlot: number }
  | { type: 'skipTurnStart' }
  | { type: 'endPlay' }
  | { type: 'playGuard'; battleCardId: BattleCardId }
  | { type: 'pass' }
  | { type: 'charge'; battleCardId: BattleCardId }
  | { type: 'endTurn' };

const MATCH_ACTION_KEYS: Record<MatchAction['type'], readonly string[]> = {
  playSkill: ['type', 'battleCardId', 'healTargetSlot', 'targetSlot', 'usingCharacterSlot'],
  playCharacter: ['type', 'battleCardId'],
  playEquipment: ['type', 'battleCardId', 'targetCharacterSlot'],
  playField: ['type', 'battleCardId'],
  turnStartAbility: ['type', 'characterSlot'],
  skipTurnStart: ['type'],
  endPlay: ['type'],
  playGuard: ['type', 'battleCardId'],
  pass: ['type'],
  charge: ['type', 'battleCardId'],
  endTurn: ['type'],
};

/** protocol actionの枝ごとのexact runtime decoder。rules上の合法性はserverが別途検証する。 */
export function parseMatchAction(value: unknown): MatchAction | null {
  if (!plainObject(value) || typeof value.type !== 'string') return null;
  const type = value.type as MatchAction['type'];
  if (!Object.hasOwn(MATCH_ACTION_KEYS, type)) return null;
  const allowed = MATCH_ACTION_KEYS[type];

  switch (type) {
    case 'playSkill': {
      if (!exactKeys(value, allowed, ['type', 'battleCardId'])) return null;
      const battleCardId = parseBattleCardId(value.battleCardId);
      if (!battleCardId) return null;
      for (const key of ['healTargetSlot', 'targetSlot', 'usingCharacterSlot'] as const) {
        if (Object.hasOwn(value, key) && !nonNegativeSafeInteger(value[key])) return null;
      }
      return {
        type,
        battleCardId,
        ...(Object.hasOwn(value, 'healTargetSlot')
          ? { healTargetSlot: value.healTargetSlot as number }
          : {}),
        ...(Object.hasOwn(value, 'targetSlot') ? { targetSlot: value.targetSlot as number } : {}),
        ...(Object.hasOwn(value, 'usingCharacterSlot')
          ? { usingCharacterSlot: value.usingCharacterSlot as number }
          : {}),
      };
    }
    case 'playCharacter':
    case 'playField':
    case 'playGuard':
    case 'charge': {
      if (!exactKeys(value, allowed, ['type', 'battleCardId'])) return null;
      const battleCardId = parseBattleCardId(value.battleCardId);
      return battleCardId ? { type, battleCardId } : null;
    }
    case 'playEquipment': {
      if (!exactKeys(value, allowed, ['type', 'battleCardId', 'targetCharacterSlot'])) {
        return null;
      }
      const battleCardId = parseBattleCardId(value.battleCardId);
      return battleCardId && nonNegativeSafeInteger(value.targetCharacterSlot)
        ? { type, battleCardId, targetCharacterSlot: value.targetCharacterSlot }
        : null;
    }
    case 'turnStartAbility':
      return exactKeys(value, allowed, ['type', 'characterSlot']) &&
        nonNegativeSafeInteger(value.characterSlot)
        ? { type, characterSlot: value.characterSlot }
        : null;
    case 'skipTurnStart':
    case 'endPlay':
    case 'pass':
    case 'endTurn':
      return exactKeys(value, allowed, ['type']) ? { type } : null;
  }
}

declare const matchIdBrand: unique symbol;
export type MatchId = string & { readonly [matchIdBrand]: true };
export const MATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function parseMatchId(value: unknown): MatchId | null {
  return typeof value === 'string' && MATCH_ID_PATTERN.test(value) ? (value as MatchId) : null;
}

declare const matchCommandIdBrand: unique symbol;
export type MatchCommandId = `cmd_${string}` & {
  readonly [matchCommandIdBrand]: true;
};
export const MATCH_COMMAND_ID_PATTERN = /^cmd_[0-9a-f]{32}$/;

export function parseMatchCommandId(value: unknown): MatchCommandId | null {
  return typeof value === 'string' && MATCH_COMMAND_ID_PATTERN.test(value)
    ? (value as MatchCommandId)
    : null;
}

declare const matchRevisionBrand: unique symbol;
export type MatchRevision = number & { readonly [matchRevisionBrand]: true };
/** increment可能な最大値を残す。通常の試合では到達不能だがoverflowを曖昧にしない。 */
export const MAX_MATCH_REVISION = Number.MAX_SAFE_INTEGER - 1;

export function parseMatchRevision(value: unknown): MatchRevision | null {
  return nonNegativeSafeInteger(value) && value <= MAX_MATCH_REVISION
    ? (value as MatchRevision)
    : null;
}

/** action schema判定前にcommandId重複とrevisionを確認するための二段decode用。 */
export interface MatchCommandCandidate {
  matchId: MatchId;
  commandId: MatchCommandId;
  expectedRevision: MatchRevision;
  action: unknown;
}

export interface MatchCommandEnvelope extends Omit<MatchCommandCandidate, 'action'> {
  action: MatchAction;
}

const MATCH_COMMAND_KEYS = ['matchId', 'commandId', 'expectedRevision', 'action'] as const;

export function parseMatchCommandCandidate(value: unknown): MatchCommandCandidate | null {
  if (!plainObject(value) || !exactKeys(value, MATCH_COMMAND_KEYS, MATCH_COMMAND_KEYS)) {
    return null;
  }
  const matchId = parseMatchId(value.matchId);
  const commandId = parseMatchCommandId(value.commandId);
  const expectedRevision = parseMatchRevision(value.expectedRevision);
  return matchId && commandId && expectedRevision !== null
    ? { matchId, commandId, expectedRevision, action: value.action }
    : null;
}

export function parseMatchCommandEnvelope(value: unknown): MatchCommandEnvelope | null {
  const candidate = parseMatchCommandCandidate(value);
  if (!candidate) return null;
  const action = parseMatchAction(candidate.action);
  return action ? { ...candidate, action } : null;
}

export const MATCH_COMMAND_ERROR_CODES = [
  'MATCH_COMMAND_ID_CONFLICT',
  'MATCH_REVISION_MISMATCH',
  'MATCH_ACTION_INVALID',
  'MATCH_ALREADY_TERMINAL',
] as const;

export type MatchCommandErrorCode = (typeof MATCH_COMMAND_ERROR_CODES)[number];

interface MatchCommandResultBase {
  type: 'matchCommandResult';
  matchId: MatchId;
  commandId: MatchCommandId;
}

export interface MatchCommandAcceptedResult extends MatchCommandResultBase {
  state: 'accepted';
  baseRevision: MatchRevision;
  revision: MatchRevision;
}

export interface MatchCommandRevisionMismatchResult extends MatchCommandResultBase {
  state: 'rejected';
  errorCode: 'MATCH_REVISION_MISMATCH';
  revision: MatchRevision;
  relation: 'stale' | 'ahead';
}

export interface MatchCommandActionOrTerminalRejectedResult extends MatchCommandResultBase {
  state: 'rejected';
  errorCode: 'MATCH_ACTION_INVALID' | 'MATCH_ALREADY_TERMINAL';
  revision: MatchRevision;
}

export interface MatchCommandIdConflictResult extends MatchCommandResultBase {
  state: 'rejected';
  errorCode: 'MATCH_COMMAND_ID_CONFLICT';
  originalRevision: MatchRevision;
}

/** error codeごとに許可fieldを分け、relation/revisionの意味を曖昧にしないreceipt。 */
export type MatchCommandResult =
  | MatchCommandAcceptedResult
  | MatchCommandRevisionMismatchResult
  | MatchCommandActionOrTerminalRejectedResult
  | MatchCommandIdConflictResult;

const MATCH_COMMAND_RESULT_BASE_KEYS = ['type', 'state', 'matchId', 'commandId'] as const;
const MATCH_COMMAND_ACCEPTED_RESULT_KEYS = [
  ...MATCH_COMMAND_RESULT_BASE_KEYS,
  'baseRevision',
  'revision',
] as const;
const MATCH_COMMAND_REVISION_MISMATCH_RESULT_KEYS = [
  ...MATCH_COMMAND_RESULT_BASE_KEYS,
  'errorCode',
  'revision',
  'relation',
] as const;
const MATCH_COMMAND_ACTION_OR_TERMINAL_RESULT_KEYS = [
  ...MATCH_COMMAND_RESULT_BASE_KEYS,
  'errorCode',
  'revision',
] as const;
const MATCH_COMMAND_ID_CONFLICT_RESULT_KEYS = [
  ...MATCH_COMMAND_RESULT_BASE_KEYS,
  'errorCode',
  'originalRevision',
] as const;

/** SQLiteやwireからreceiptを戻すtrust boundary用のexact decoder。 */
export function parseMatchCommandResult(value: unknown): MatchCommandResult | null {
  if (
    !plainObject(value) ||
    value.type !== 'matchCommandResult' ||
    (value.state !== 'accepted' && value.state !== 'rejected')
  ) {
    return null;
  }
  const matchId = parseMatchId(value.matchId);
  const commandId = parseMatchCommandId(value.commandId);
  if (!matchId || !commandId) return null;

  if (value.state === 'accepted') {
    if (!exactKeys(value, MATCH_COMMAND_ACCEPTED_RESULT_KEYS, MATCH_COMMAND_ACCEPTED_RESULT_KEYS)) {
      return null;
    }
    const baseRevision = parseMatchRevision(value.baseRevision);
    const revision = parseMatchRevision(value.revision);
    return baseRevision !== null && revision !== null && revision === baseRevision + 1
      ? {
          type: 'matchCommandResult',
          state: 'accepted',
          matchId,
          commandId,
          baseRevision,
          revision,
        }
      : null;
  }

  if (value.errorCode === 'MATCH_REVISION_MISMATCH') {
    if (
      !exactKeys(
        value,
        MATCH_COMMAND_REVISION_MISMATCH_RESULT_KEYS,
        MATCH_COMMAND_REVISION_MISMATCH_RESULT_KEYS,
      ) ||
      (value.relation !== 'stale' && value.relation !== 'ahead')
    ) {
      return null;
    }
    const revision = parseMatchRevision(value.revision);
    return revision === null
      ? null
      : {
          type: 'matchCommandResult',
          state: 'rejected',
          matchId,
          commandId,
          errorCode: 'MATCH_REVISION_MISMATCH',
          revision,
          relation: value.relation,
        };
  }

  if (
    value.errorCode === 'MATCH_ACTION_INVALID' ||
    value.errorCode === 'MATCH_ALREADY_TERMINAL'
  ) {
    if (
      !exactKeys(
        value,
        MATCH_COMMAND_ACTION_OR_TERMINAL_RESULT_KEYS,
        MATCH_COMMAND_ACTION_OR_TERMINAL_RESULT_KEYS,
      )
    ) {
      return null;
    }
    const revision = parseMatchRevision(value.revision);
    return revision === null
      ? null
      : {
          type: 'matchCommandResult',
          state: 'rejected',
          matchId,
          commandId,
          errorCode: value.errorCode,
          revision,
        };
  }

  if (value.errorCode !== 'MATCH_COMMAND_ID_CONFLICT') return null;
  if (
    !exactKeys(
      value,
      MATCH_COMMAND_ID_CONFLICT_RESULT_KEYS,
      MATCH_COMMAND_ID_CONFLICT_RESULT_KEYS,
    )
  ) {
    return null;
  }
  const originalRevision = parseMatchRevision(value.originalRevision);
  return originalRevision === null
    ? null
    : {
        type: 'matchCommandResult',
        state: 'rejected',
        matchId,
        commandId,
        errorCode: 'MATCH_COMMAND_ID_CONFLICT',
        originalRevision,
      };
}
