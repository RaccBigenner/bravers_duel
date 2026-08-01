/**
 * OLG-124でplayer projectionとbrowser command/update wire v1を固定した入口。
 * authoritative snapshot/raw engine eventはserver内部限定。delta/reconnectはOLG-126で追加する。
 */
export const PROTOCOL_SCAFFOLD = {
  version: 'OLG-124',
  operational: true,
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

/** OLG-124 browser wireの版。権威snapshotやengine eventとは独立に更新する。 */
export const MATCH_PLAYER_PROJECTION_VERSION = 1 as const;

export type MatchProjectionPlayerIndex = 0 | 1;
export type MatchProjectionPhase = 'choice' | 'play' | 'guard' | 'charge' | 'finished';
export type MatchViewerSeat = 'player-1' | 'player-2';

export interface MatchPublicCardProjection {
  battleCardId: BattleCardId;
  printingId: string;
}

export interface MatchCharacterProjection {
  card: MatchPublicCardProjection;
  damage: number;
  addedAttributes: string[];
  equipment: MatchPublicCardProjection | null;
}

export interface MatchPrivateHandProjection {
  visibility: 'private';
  cards: MatchPublicCardProjection[];
}

export interface MatchHiddenHandProjection {
  visibility: 'hidden';
  count: number;
}

export interface MatchPlayerBoardProjection {
  player: MatchProjectionPlayerIndex;
  deckCount: number;
  hand: MatchPrivateHandProjection | MatchHiddenHandProjection;
  trash: MatchPublicCardProjection[];
  apCount: number;
  characters: MatchCharacterProjection[];
  actorSlot: number;
  skillsUsedThisTurn: number;
  nextSkillCostDelta: number;
  nextDrawDelta: number;
  actorLockUntilTurn: number;
  incomingDamageReduction: { value: number; untilTurn: number } | null;
  chargedThisTurn: number;
}

export interface MatchPendingAttackProjection {
  skillPrintingId: string;
  value: number;
  targeting: 'actor' | 'all' | 'standby' | 'choose';
  chosenSlot?: number;
  noGuard: boolean;
  attackerSlot: number;
  suppressRotate: boolean;
  guard: { characterSlot: number; value: number } | null;
}

export interface MatchFieldProjection extends MatchPublicCardProjection {
  owner: MatchProjectionPlayerIndex;
}

export type MatchTerminalProjection =
  | {
      state: 'finished';
      winner: MatchProjectionPlayerIndex | null;
      reason: 'wipeout' | 'deckout' | 'turnLimit';
    }
  | {
      state: 'cancelled';
      winner: null;
      reason: 'server_cancelled' | 'start_failed';
    }
  | {
      state: 'abandoned';
      winner: 1;
      reason: 'player_abandoned';
    };

/**
 * allowlistだけで組み立てるviewer別盤面。
 * raw BattleState/event/header/hash/seedと相手hidden zoneの配列は型として存在させない。
 */
export interface MatchPlayerProjection {
  type: 'matchPlayerProjection';
  projectionVersion: typeof MATCH_PLAYER_PROJECTION_VERSION;
  matchId: MatchId;
  viewerSeat: MatchViewerSeat;
  viewerPlayer: MatchProjectionPlayerIndex;
  revision: MatchRevision;
  eventSequence: number;
  contentVersion: string;
  formatVersionId: string;
  turn: number;
  activePlayer: MatchProjectionPlayerIndex;
  phase: MatchProjectionPhase;
  firstPlayer: MatchProjectionPlayerIndex;
  pendingAttack: MatchPendingAttackProjection | null;
  field: MatchFieldProjection | null;
  players: [MatchPlayerBoardProjection, MatchPlayerBoardProjection];
  winner: MatchProjectionPlayerIndex | null;
  endReason: 'wipeout' | 'deckout' | 'turnLimit' | null;
  terminal: MatchTerminalProjection | null;
  legalActions: MatchAction[];
}

export interface MatchCommandClientFrame {
  type: 'matchCommand';
  command: MatchCommandCandidate;
}

export interface MatchProjectionServerFrame {
  type: 'matchProjection';
  projection: MatchPlayerProjection;
}

export interface MatchCommandUpdateServerFrame {
  type: 'matchCommandUpdate';
  receipt: MatchCommandResult;
  projection: MatchPlayerProjection;
}

export type MatchServerFrame = MatchProjectionServerFrame | MatchCommandUpdateServerFrame;

const PUBLIC_CARD_KEYS = ['battleCardId', 'printingId'] as const;
const CHARACTER_PROJECTION_KEYS = ['card', 'damage', 'addedAttributes', 'equipment'] as const;
const PLAYER_BOARD_KEYS = [
  'player',
  'deckCount',
  'hand',
  'trash',
  'apCount',
  'characters',
  'actorSlot',
  'skillsUsedThisTurn',
  'nextSkillCostDelta',
  'nextDrawDelta',
  'actorLockUntilTurn',
  'incomingDamageReduction',
  'chargedThisTurn',
] as const;
const PENDING_ATTACK_KEYS = [
  'skillPrintingId',
  'value',
  'targeting',
  'chosenSlot',
  'noGuard',
  'attackerSlot',
  'suppressRotate',
  'guard',
] as const;
const PLAYER_PROJECTION_KEYS = [
  'type',
  'projectionVersion',
  'matchId',
  'viewerSeat',
  'viewerPlayer',
  'revision',
  'eventSequence',
  'contentVersion',
  'formatVersionId',
  'turn',
  'activePlayer',
  'phase',
  'firstPlayer',
  'pendingAttack',
  'field',
  'players',
  'winner',
  'endReason',
  'terminal',
  'legalActions',
] as const;

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function projectionPlayer(value: unknown): value is MatchProjectionPlayerIndex {
  return value === 0 || value === 1;
}

function boundedProjectionString(value: unknown, maxLength = 128): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= maxLength;
}

function parsePublicCardProjection(value: unknown): MatchPublicCardProjection | null {
  if (!plainObject(value) || !exactKeys(value, PUBLIC_CARD_KEYS, PUBLIC_CARD_KEYS)) return null;
  const battleCardId = parseBattleCardId(value.battleCardId);
  return battleCardId && boundedProjectionString(value.printingId)
    ? { battleCardId, printingId: value.printingId }
    : null;
}

function parsePublicCardList(value: unknown, maxLength = 128): MatchPublicCardProjection[] | null {
  if (!Array.isArray(value) || value.length > maxLength) return null;
  const cards: MatchPublicCardProjection[] = [];
  for (const raw of value) {
    const card = parsePublicCardProjection(raw);
    if (!card) return null;
    cards.push(card);
  }
  return cards;
}

function parseProjectionStringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 32) return null;
  const strings: string[] = [];
  for (const item of value) {
    if (!boundedProjectionString(item, 64)) return null;
    strings.push(item);
  }
  return strings;
}

function parseCharacterProjection(value: unknown): MatchCharacterProjection | null {
  if (
    !plainObject(value) ||
    !exactKeys(value, CHARACTER_PROJECTION_KEYS, CHARACTER_PROJECTION_KEYS) ||
    !nonNegativeSafeInteger(value.damage)
  ) {
    return null;
  }
  const card = parsePublicCardProjection(value.card);
  const addedAttributes = parseProjectionStringList(value.addedAttributes);
  const equipment = value.equipment === null ? null : parsePublicCardProjection(value.equipment);
  return card && addedAttributes && (value.equipment === null || equipment)
    ? { card, damage: value.damage, addedAttributes, equipment }
    : null;
}

function parseHandProjection(
  value: unknown,
  privateForViewer: boolean,
): MatchPrivateHandProjection | MatchHiddenHandProjection | null {
  if (!plainObject(value)) return null;
  if (privateForViewer) {
    if (!exactKeys(value, ['visibility', 'cards'], ['visibility', 'cards'])) return null;
    const cards = parsePublicCardList(value.cards, 64);
    return value.visibility === 'private' && cards ? { visibility: 'private', cards } : null;
  }
  return exactKeys(value, ['visibility', 'count'], ['visibility', 'count']) &&
    value.visibility === 'hidden' &&
    nonNegativeSafeInteger(value.count)
    ? { visibility: 'hidden', count: value.count }
    : null;
}

function parsePlayerBoardProjection(
  value: unknown,
  expectedPlayer: MatchProjectionPlayerIndex,
  viewerPlayer: MatchProjectionPlayerIndex,
): MatchPlayerBoardProjection | null {
  if (
    !plainObject(value) ||
    !exactKeys(value, PLAYER_BOARD_KEYS, PLAYER_BOARD_KEYS) ||
    value.player !== expectedPlayer ||
    !nonNegativeSafeInteger(value.deckCount) ||
    !nonNegativeSafeInteger(value.apCount) ||
    !nonNegativeSafeInteger(value.actorSlot) ||
    !nonNegativeSafeInteger(value.skillsUsedThisTurn) ||
    !safeInteger(value.nextSkillCostDelta) ||
    !safeInteger(value.nextDrawDelta) ||
    !nonNegativeSafeInteger(value.actorLockUntilTurn) ||
    !nonNegativeSafeInteger(value.chargedThisTurn) ||
    !Array.isArray(value.characters) ||
    value.characters.length > 4
  ) {
    return null;
  }
  const hand = parseHandProjection(value.hand, expectedPlayer === viewerPlayer);
  const trash = parsePublicCardList(value.trash);
  if (!hand || !trash) return null;
  const characters: MatchCharacterProjection[] = [];
  for (const raw of value.characters) {
    const character = parseCharacterProjection(raw);
    if (!character) return null;
    characters.push(character);
  }
  let incomingDamageReduction: MatchPlayerBoardProjection['incomingDamageReduction'] = null;
  if (value.incomingDamageReduction !== null) {
    if (
      !plainObject(value.incomingDamageReduction) ||
      !exactKeys(
        value.incomingDamageReduction,
        ['value', 'untilTurn'],
        ['value', 'untilTurn'],
      ) ||
      !nonNegativeSafeInteger(value.incomingDamageReduction.value) ||
      !nonNegativeSafeInteger(value.incomingDamageReduction.untilTurn)
    ) {
      return null;
    }
    incomingDamageReduction = {
      value: value.incomingDamageReduction.value,
      untilTurn: value.incomingDamageReduction.untilTurn,
    };
  }
  return {
    player: expectedPlayer,
    deckCount: value.deckCount,
    hand,
    trash,
    apCount: value.apCount,
    characters,
    actorSlot: value.actorSlot,
    skillsUsedThisTurn: value.skillsUsedThisTurn,
    nextSkillCostDelta: value.nextSkillCostDelta,
    nextDrawDelta: value.nextDrawDelta,
    actorLockUntilTurn: value.actorLockUntilTurn,
    incomingDamageReduction,
    chargedThisTurn: value.chargedThisTurn,
  };
}

function parsePendingAttackProjection(value: unknown): MatchPendingAttackProjection | null {
  if (
    !plainObject(value) ||
    !exactKeys(
      value,
      PENDING_ATTACK_KEYS,
      PENDING_ATTACK_KEYS.filter((key) => key !== 'chosenSlot'),
    ) ||
    !boundedProjectionString(value.skillPrintingId) ||
    !safeInteger(value.value) ||
    !['actor', 'all', 'standby', 'choose'].includes(String(value.targeting)) ||
    (Object.hasOwn(value, 'chosenSlot') && !nonNegativeSafeInteger(value.chosenSlot)) ||
    typeof value.noGuard !== 'boolean' ||
    !nonNegativeSafeInteger(value.attackerSlot) ||
    typeof value.suppressRotate !== 'boolean'
  ) {
    return null;
  }
  let guard: MatchPendingAttackProjection['guard'] = null;
  if (value.guard !== null) {
    if (
      !plainObject(value.guard) ||
      !exactKeys(value.guard, ['characterSlot', 'value'], ['characterSlot', 'value']) ||
      !nonNegativeSafeInteger(value.guard.characterSlot) ||
      !nonNegativeSafeInteger(value.guard.value)
    ) {
      return null;
    }
    guard = { characterSlot: value.guard.characterSlot, value: value.guard.value };
  }
  return {
    skillPrintingId: value.skillPrintingId,
    value: value.value,
    targeting: value.targeting as MatchPendingAttackProjection['targeting'],
    ...(Object.hasOwn(value, 'chosenSlot') ? { chosenSlot: value.chosenSlot as number } : {}),
    noGuard: value.noGuard,
    attackerSlot: value.attackerSlot,
    suppressRotate: value.suppressRotate,
    guard,
  };
}

function parseTerminalProjection(value: unknown): MatchTerminalProjection | null {
  if (
    !plainObject(value) ||
    !exactKeys(value, ['state', 'winner', 'reason'], ['state', 'winner', 'reason'])
  ) {
    return null;
  }
  if (
    value.state === 'finished' &&
    (value.winner === null || projectionPlayer(value.winner)) &&
    (value.reason === 'wipeout' || value.reason === 'deckout' || value.reason === 'turnLimit')
  ) {
    return { state: 'finished', winner: value.winner, reason: value.reason };
  }
  if (
    value.state === 'cancelled' &&
    value.winner === null &&
    (value.reason === 'server_cancelled' || value.reason === 'start_failed')
  ) {
    return { state: 'cancelled', winner: null, reason: value.reason };
  }
  return value.state === 'abandoned' &&
    value.winner === 1 &&
    value.reason === 'player_abandoned'
    ? { state: 'abandoned', winner: 1, reason: 'player_abandoned' }
    : null;
}

/** browserが受け取るplayer projection用のnested exact decoder。 */
export function parseMatchPlayerProjection(value: unknown): MatchPlayerProjection | null {
  if (
    !plainObject(value) ||
    !exactKeys(value, PLAYER_PROJECTION_KEYS, PLAYER_PROJECTION_KEYS) ||
    value.type !== 'matchPlayerProjection' ||
    value.projectionVersion !== MATCH_PLAYER_PROJECTION_VERSION ||
    (value.viewerSeat !== 'player-1' && value.viewerSeat !== 'player-2') ||
    !projectionPlayer(value.viewerPlayer) ||
    (value.viewerSeat === 'player-1' ? value.viewerPlayer !== 0 : value.viewerPlayer !== 1) ||
    !nonNegativeSafeInteger(value.eventSequence) ||
    !boundedProjectionString(value.contentVersion) ||
    !boundedProjectionString(value.formatVersionId) ||
    !nonNegativeSafeInteger(value.turn) ||
    !projectionPlayer(value.activePlayer) ||
    !['choice', 'play', 'guard', 'charge', 'finished'].includes(String(value.phase)) ||
    !projectionPlayer(value.firstPlayer) ||
    (value.winner !== null && !projectionPlayer(value.winner)) ||
    ![null, 'wipeout', 'deckout', 'turnLimit'].includes(value.endReason as null | string) ||
    !Array.isArray(value.players) ||
    value.players.length !== 2 ||
    !Array.isArray(value.legalActions) ||
    value.legalActions.length > 128
  ) {
    return null;
  }
  const matchId = parseMatchId(value.matchId);
  const revision = parseMatchRevision(value.revision);
  const first = parsePlayerBoardProjection(value.players[0], 0, value.viewerPlayer);
  const second = parsePlayerBoardProjection(value.players[1], 1, value.viewerPlayer);
  const pendingAttack = value.pendingAttack === null
    ? null
    : parsePendingAttackProjection(value.pendingAttack);
  let field: MatchFieldProjection | null = null;
  if (value.field !== null) {
    if (
      !plainObject(value.field) ||
      !exactKeys(value.field, ['battleCardId', 'printingId', 'owner'], ['battleCardId', 'printingId', 'owner']) ||
      !projectionPlayer(value.field.owner)
    ) {
      return null;
    }
    const battleCardId = parseBattleCardId(value.field.battleCardId);
    if (!battleCardId || !boundedProjectionString(value.field.printingId)) return null;
    field = {
      battleCardId,
      printingId: value.field.printingId,
      owner: value.field.owner,
    };
  }
  const terminal = value.terminal === null ? null : parseTerminalProjection(value.terminal);
  const actingPlayer = value.phase === 'guard' ? 1 - value.activePlayer : value.activePlayer;
  if (
    !matchId ||
    revision === null ||
    !first ||
    !second ||
    (value.pendingAttack !== null && !pendingAttack) ||
    (value.terminal !== null && !terminal) ||
    (terminal !== null && value.legalActions.length !== 0) ||
    (terminal === null && (value.winner !== null || value.endReason !== null)) ||
    (terminal?.state === 'finished' &&
      (value.phase !== 'finished' ||
        value.winner !== terminal.winner ||
        value.endReason !== terminal.reason)) ||
    (terminal !== null &&
      terminal.state !== 'finished' &&
      (value.phase === 'finished' || value.winner !== null || value.endReason !== null)) ||
    (terminal === null && value.phase === 'finished') ||
    (value.legalActions.length > 0 && value.viewerPlayer !== actingPlayer)
  ) {
    return null;
  }
  const legalActions: MatchAction[] = [];
  const ownHand = value.viewerPlayer === 0 ? first.hand : second.hand;
  if (ownHand.visibility !== 'private') return null;
  const ownHandIds = new Set(ownHand.cards.map((card) => card.battleCardId));
  for (const raw of value.legalActions) {
    const action = parseMatchAction(raw);
    if (!action || ('battleCardId' in action && !ownHandIds.has(action.battleCardId))) return null;
    legalActions.push(action);
  }
  return {
    type: 'matchPlayerProjection',
    projectionVersion: MATCH_PLAYER_PROJECTION_VERSION,
    matchId,
    viewerSeat: value.viewerSeat,
    viewerPlayer: value.viewerPlayer,
    revision,
    eventSequence: value.eventSequence,
    contentVersion: value.contentVersion,
    formatVersionId: value.formatVersionId,
    turn: value.turn,
    activePlayer: value.activePlayer,
    phase: value.phase as MatchProjectionPhase,
    firstPlayer: value.firstPlayer,
    pendingAttack,
    field,
    players: [first, second],
    winner: value.winner,
    endReason: value.endReason as MatchPlayerProjection['endReason'],
    terminal,
    legalActions,
  };
}

/** action schema前のdomain拒否もreceiptへ固定できるようcandidateまでをdecodeする。 */
export function parseMatchCommandClientFrame(value: unknown): MatchCommandClientFrame | null {
  if (
    !plainObject(value) ||
    !exactKeys(value, ['type', 'command'], ['type', 'command']) ||
    value.type !== 'matchCommand'
  ) {
    return null;
  }
  const command = parseMatchCommandCandidate(value.command);
  return command ? { type: 'matchCommand', command } : null;
}

export function parseMatchServerFrame(value: unknown): MatchServerFrame | null {
  if (!plainObject(value) || typeof value.type !== 'string') return null;
  if (value.type === 'matchProjection') {
    if (!exactKeys(value, ['type', 'projection'], ['type', 'projection'])) return null;
    const projection = parseMatchPlayerProjection(value.projection);
    return projection ? { type: 'matchProjection', projection } : null;
  }
  if (
    value.type !== 'matchCommandUpdate' ||
    !exactKeys(value, ['type', 'receipt', 'projection'], ['type', 'receipt', 'projection'])
  ) {
    return null;
  }
  const receipt = parseMatchCommandResult(value.receipt);
  const projection = parseMatchPlayerProjection(value.projection);
  if (!receipt || !projection || receipt.matchId !== projection.matchId) return null;
  const receiptRevision = receipt.state === 'accepted'
    ? receipt.revision
    : receipt.errorCode === 'MATCH_COMMAND_ID_CONFLICT'
      ? receipt.originalRevision
      : receipt.revision;
  return receiptRevision <= projection.revision
    ? { type: 'matchCommandUpdate', receipt, projection }
    : null;
}
