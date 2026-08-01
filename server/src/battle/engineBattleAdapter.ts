import {
  CONTENT_VERSION,
  DEFAULT_FORMAT,
  ENGINE_VERSION,
  actingPlayer,
  applyActionWithCardTrace,
  checkDeckForMatchStart,
  createBattle,
  fingerprintOf,
  formatByVersionId,
  formatVersionId,
  legalActions,
  sampleArchetypeDecks,
  searchAi,
  stableStringify,
  stateHash,
  type BattleAction,
  type BattleCardLocation,
  type BattleCardMutation,
  type BattleEvent,
  type BattleState,
  type DeckList,
  type EndReason,
  type PlayerIndex,
} from '@bravers/engine';
import {
  parseBattleCardId,
  parseMatchAction,
  type BattleCardId,
  type MatchAction,
} from '@bravers/protocol';

export { parseMatchAction } from '@bravers/protocol';

export const ENGINE_BATTLE_ADAPTER_VERSION = 2 as const;
export const G1_NPC_POLICY_ID = 'search-v1-keep2' as const;
export const G1_NPC_PLAYER_DECK_ID = 'standard-0' as const;
export const G1_NPC_OPPONENT_DECK_ID = 'standard-1' as const;
export const HUMAN_PLAYER = 0 as const satisfies PlayerIndex;
export const NPC_PLAYER = 1 as const satisfies PlayerIndex;
export const MAX_NPC_ACTIONS_PER_TRANSITION = 512;

export type EngineBattleAdapterErrorCode =
  | 'BATTLE_SETUP_INVALID'
  | 'BATTLE_VERSION_MISMATCH'
  | 'BATTLE_FORMAT_UNKNOWN'
  | 'BATTLE_DECK_INVALID'
  | 'BATTLE_RUNTIME_INVALID'
  | 'BATTLE_ACTION_INVALID'
  | 'BATTLE_IDENTITY_INVALID'
  | 'BATTLE_NOT_HUMAN_TURN'
  | 'BATTLE_ALREADY_FINISHED'
  | 'BATTLE_ENGINE_FAILURE'
  | 'BATTLE_NPC_WATCHDOG_EXCEEDED';

export class EngineBattleAdapterError extends Error {
  constructor(public readonly code: EngineBattleAdapterErrorCode) {
    super(code);
    this.name = 'EngineBattleAdapterError';
  }
}

export interface EngineBattleVersions {
  adapterVersion: typeof ENGINE_BATTLE_ADAPTER_VERSION;
  engineVersion: string;
  contentVersion: string;
  formatVersionId: string;
  npcPolicyId: typeof G1_NPC_POLICY_ID;
}

export interface CreateNpcBattleInput {
  seed: number;
  versions: EngineBattleVersions;
  decks: [DeckList, DeckList];
}

export interface AuthoritativeBattleHeader extends EngineBattleVersions {
  seed: number;
  firstPlayer: PlayerIndex;
  firstPlayerFromSeed: true;
  humanPlayer: typeof HUMAN_PLAYER;
  manualFor: typeof HUMAN_PLAYER;
  decks: [DeckList, DeckList];
}

export interface AppliedBattleStep {
  sequence: number;
  player: PlayerIndex;
  source: 'human' | 'npc';
  action: MatchAction;
  stateHash: string;
  identityHash: string;
  events: BattleEvent[];
}

export interface BattleCardIdentity {
  battleCardId: BattleCardId;
  printingId: string;
  owner: PlayerIndex;
}

export interface PlayerBattleCardLedger {
  deck: BattleCardIdentity[];
  hand: BattleCardIdentity[];
  trash: BattleCardIdentity[];
  ap: BattleCardIdentity[];
  characters: BattleCardIdentity[];
  equipment: Array<BattleCardIdentity | null>;
}

/** MatchDO内部だけで扱う全zoneのbattle-localカード個体台帳。 */
export interface BattleCardLedger {
  players: [PlayerBattleCardLedger, PlayerBattleCardLedger];
  field: BattleCardIdentity | null;
}

/**
 * MatchDO内部だけで扱う権威snapshot。
 * 相手hand/deck/rngStateを含むため、OLG-124のprojection前にwireへ出してはいけない。
 */
export interface AuthoritativeBattleSnapshot {
  header: AuthoritativeBattleHeader;
  /** createBattle直後・NPC先攻pump前に発生した、欠落のない初期event列。 */
  initialEvents: BattleEvent[];
  /** createBattle完了後・NPC先攻pump前のimmutableなID配置。復旧時に再採番しない。 */
  initialBattleCards: BattleCardLedger;
  initialIdentityHash: string;
  state: BattleState;
  battleCards: BattleCardLedger;
  steps: AppliedBattleStep[];
  currentStateHash: string;
  currentIdentityHash: string;
}

/** OLG-125が永続化する再演可能な最小履歴。current snapshotは別途照合する。 */
export interface RestoreNpcBattleHistoryInput {
  header: AuthoritativeBattleHeader;
  initialBattleCards: BattleCardLedger;
  initialIdentityHash: string;
  steps: AppliedBattleStep[];
}

export interface NpcBattleStatus {
  phase: BattleState['phase'];
  turn: number;
  actingPlayer: PlayerIndex | null;
  winner: PlayerIndex | null;
  endReason: EndReason | null;
  stateHash: string;
  identityHash: string;
  appliedActions: number;
}

export interface NpcBattleResult {
  winner: PlayerIndex | null;
  endReason: EndReason;
  turns: number;
  finalStateHash: string;
  finalIdentityHash: string;
  appliedActions: number;
}

export interface AppliedBattleTransition {
  steps: AppliedBattleStep[];
  status: NpcBattleStatus;
}

const ENGINE_ACTION_KEYS: Record<BattleAction['type'], readonly string[]> = {
  playSkill: ['type', 'handIndex', 'healTargetIndex', 'targetIndex', 'usingIndex'],
  playCharacter: ['type', 'handIndex'],
  playEquipment: ['type', 'handIndex', 'targetIndex'],
  playField: ['type', 'handIndex'],
  turnStartAbility: ['type', 'charIndex'],
  skipTurnStart: ['type'],
  endPlay: ['type'],
  playGuard: ['type', 'handIndex'],
  pass: ['type'],
  charge: ['type', 'handIndex'],
  endTurn: ['type'],
};

const VERSION_KEYS = [
  'adapterVersion',
  'engineVersion',
  'contentVersion',
  'formatVersionId',
  'npcPolicyId',
] as const;

const HEADER_KEYS = [
  ...VERSION_KEYS,
  'seed',
  'firstPlayer',
  'firstPlayerFromSeed',
  'humanPlayer',
  'manualFor',
  'decks',
] as const;

const RESTORE_HISTORY_KEYS = [
  'header',
  'initialBattleCards',
  'initialIdentityHash',
  'steps',
] as const;

const APPLIED_STEP_KEYS = [
  'sequence',
  'player',
  'source',
  'action',
  'stateHash',
  'identityHash',
  'events',
] as const;

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
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.includes(key))
  );
}

function indexValue(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** engine-native actionのstrict decoder。adapter外へは返さない。 */
function parseInternalBattleAction(value: unknown): BattleAction | null {
  if (!plainObject(value) || typeof value.type !== 'string') return null;
  const type = value.type as BattleAction['type'];
  if (!Object.hasOwn(ENGINE_ACTION_KEYS, type)) return null;
  const allowed = ENGINE_ACTION_KEYS[type];

  switch (type) {
    case 'playSkill': {
      if (!exactKeys(value, allowed, ['type', 'handIndex']) || !indexValue(value.handIndex)) {
        return null;
      }
      for (const key of ['healTargetIndex', 'targetIndex', 'usingIndex'] as const) {
        if (Object.hasOwn(value, key) && !indexValue(value[key])) return null;
      }
      return {
        type,
        handIndex: value.handIndex,
        ...(Object.hasOwn(value, 'healTargetIndex')
          ? { healTargetIndex: value.healTargetIndex as number }
          : {}),
        ...(Object.hasOwn(value, 'targetIndex')
          ? { targetIndex: value.targetIndex as number }
          : {}),
        ...(Object.hasOwn(value, 'usingIndex')
          ? { usingIndex: value.usingIndex as number }
          : {}),
      };
    }
    case 'playCharacter':
    case 'playField':
    case 'playGuard':
    case 'charge':
      return exactKeys(value, allowed, ['type', 'handIndex']) && indexValue(value.handIndex)
        ? { type, handIndex: value.handIndex }
        : null;
    case 'playEquipment':
      return exactKeys(value, allowed, ['type', 'handIndex', 'targetIndex']) &&
        indexValue(value.handIndex) &&
        indexValue(value.targetIndex)
        ? { type, handIndex: value.handIndex, targetIndex: value.targetIndex }
        : null;
    case 'turnStartAbility':
      return exactKeys(value, allowed, ['type', 'charIndex']) && indexValue(value.charIndex)
        ? { type, charIndex: value.charIndex }
        : null;
    case 'skipTurnStart':
    case 'endPlay':
    case 'pass':
    case 'endTurn':
      return exactKeys(value, allowed, ['type']) ? { type } : null;
  }
}

function cloneDeck(deck: DeckList): DeckList {
  return {
    characterIds: [...deck.characterIds],
    cardIds: [...deck.cardIds],
  };
}

function cloneDecks(decks: [DeckList, DeckList]): [DeckList, DeckList] {
  return [cloneDeck(decks[0]), cloneDeck(decks[1])];
}

function validDeck(value: unknown): value is DeckList {
  return (
    plainObject(value) &&
    exactKeys(value, ['characterIds', 'cardIds'], ['characterIds', 'cardIds']) &&
    Array.isArray(value.characterIds) &&
    Array.isArray(value.cardIds) &&
    value.characterIds.every((id) => typeof id === 'string' && id.length > 0) &&
    value.cardIds.every((id) => typeof id === 'string' && id.length > 0)
  );
}

function validDeckPair(value: unknown): value is [DeckList, DeckList] {
  return Array.isArray(value) && value.length === 2 && validDeck(value[0]) && validDeck(value[1]);
}

function validSeed(seed: unknown): seed is number {
  return Number.isSafeInteger(seed) && Number(seed) >= 0 && Number(seed) <= 0xffff_ffff;
}

export type BattleCardIdGenerator = () => unknown;

function randomBattleCardId(): BattleCardId {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const parsed = parseBattleCardId(
    `bc_${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`,
  );
  if (!parsed) throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
  return parsed;
}

function createBattleCardIdentity(
  printingId: string,
  owner: PlayerIndex,
  generate: BattleCardIdGenerator,
  used: Set<BattleCardId>,
): BattleCardIdentity {
  let generated: unknown;
  try {
    generated = generate();
  } catch {
    throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
  }
  const battleCardId = parseBattleCardId(generated);
  if (!battleCardId || used.has(battleCardId)) {
    throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
  }
  used.add(battleCardId);
  return { battleCardId, printingId, owner };
}

function createBattleCardLedger(
  state: BattleState,
  generate: BattleCardIdGenerator,
): { ledger: BattleCardLedger; catalog: readonly BattleCardIdentity[] } {
  const used = new Set<BattleCardId>();
  const catalog: BattleCardIdentity[] = [];
  const create = (printingId: string, owner: PlayerIndex): BattleCardIdentity => {
    const identity = createBattleCardIdentity(printingId, owner, generate, used);
    catalog.push(Object.freeze({ ...identity }));
    return identity;
  };
  const players = ([0, 1] as const).map((player) => {
    const current = state.players[player];
    return {
      deck: current.deck.map((printingId) => create(printingId, player)),
      hand: current.hand.map((printingId) => create(printingId, player)),
      trash: current.trash.map((printingId) => create(printingId, player)),
      ap: current.ap.map((printingId) => create(printingId, player)),
      characters: current.characters.map((character) => create(character.cardId, player)),
      equipment: current.characters.map((character) =>
        character.equipmentCardId === null
          ? null
          : create(character.equipmentCardId, player)),
    } satisfies PlayerBattleCardLedger;
  }) as [PlayerBattleCardLedger, PlayerBattleCardLedger];
  const field = state.field === null
    ? null
    : create(state.field.cardId, state.field.owner);
  return { ledger: { players, field }, catalog: Object.freeze([...catalog]) };
}

const ARRAY_ZONES = ['deck', 'hand', 'trash', 'ap'] as const;
type BattleCardArrayZone = (typeof ARRAY_ZONES)[number];

function playerValue(value: unknown): value is PlayerIndex {
  return value === 0 || value === 1;
}

function arrayZoneValue(value: unknown): value is BattleCardArrayZone {
  return typeof value === 'string' && ARRAY_ZONES.includes(value as BattleCardArrayZone);
}

function validLocation(value: unknown): value is BattleCardLocation {
  if (!plainObject(value) || typeof value.type !== 'string') return false;
  if (value.type === 'array') {
    return exactKeys(value, ['type', 'player', 'zone', 'index'], ['type', 'player', 'zone', 'index']) &&
      playerValue(value.player) &&
      arrayZoneValue(value.zone) &&
      indexValue(value.index);
  }
  if (value.type === 'equipment') {
    return exactKeys(
      value,
      ['type', 'player', 'characterSlot'],
      ['type', 'player', 'characterSlot'],
    ) && playerValue(value.player) && indexValue(value.characterSlot);
  }
  return value.type === 'field' && exactKeys(value, ['type'], ['type']);
}

function arrayAt(
  ledger: BattleCardLedger,
  location: Extract<BattleCardLocation, { type: 'array' }>,
): BattleCardIdentity[] {
  return ledger.players[location.player][location.zone];
}

function takeCardAt(
  ledger: BattleCardLedger,
  location: BattleCardLocation,
): BattleCardIdentity {
  if (location.type === 'array') {
    const cards = arrayAt(ledger, location);
    if (location.index >= cards.length) {
      throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
    }
    return cards.splice(location.index, 1)[0]!;
  }
  if (location.type === 'equipment') {
    const equipment = ledger.players[location.player].equipment;
    if (location.characterSlot >= equipment.length || equipment[location.characterSlot] === null) {
      throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
    }
    const card = equipment[location.characterSlot]!;
    equipment[location.characterSlot] = null;
    return card;
  }
  if (ledger.field === null) {
    throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
  }
  const card = ledger.field;
  ledger.field = null;
  return card;
}

function putCardAt(
  ledger: BattleCardLedger,
  location: BattleCardLocation,
  card: BattleCardIdentity,
): void {
  if (location.type === 'array') {
    if (card.owner !== location.player) {
      throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
    }
    const cards = arrayAt(ledger, location);
    if (location.index > cards.length) {
      throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
    }
    cards.splice(location.index, 0, card);
    return;
  }
  if (location.type === 'equipment') {
    if (card.owner !== location.player) {
      throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
    }
    const equipment = ledger.players[location.player].equipment;
    if (location.characterSlot >= equipment.length || equipment[location.characterSlot] !== null) {
      throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
    }
    equipment[location.characterSlot] = card;
    return;
  }
  if (ledger.field !== null) {
    throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
  }
  ledger.field = card;
}

function applyBattleCardMutation(ledger: BattleCardLedger, mutation: BattleCardMutation): void {
  if (!plainObject(mutation) || typeof mutation.type !== 'string') {
    throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
  }
  if (mutation.type === 'swap') {
    if (
      !exactKeys(
        mutation,
        ['type', 'player', 'zone', 'leftIndex', 'rightIndex'],
        ['type', 'player', 'zone', 'leftIndex', 'rightIndex'],
      ) ||
      !playerValue(mutation.player) ||
      mutation.zone !== 'deck' ||
      !indexValue(mutation.leftIndex) ||
      !indexValue(mutation.rightIndex)
    ) {
      throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
    }
    const deck = ledger.players[mutation.player].deck;
    if (mutation.leftIndex >= deck.length || mutation.rightIndex >= deck.length) {
      throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
    }
    [deck[mutation.leftIndex], deck[mutation.rightIndex]] = [
      deck[mutation.rightIndex]!,
      deck[mutation.leftIndex]!,
    ];
    return;
  }
  if (
    mutation.type !== 'move' ||
    !exactKeys(
      mutation,
      ['type', 'printingId', 'from', 'to'],
      ['type', 'printingId', 'from', 'to'],
    ) ||
    typeof mutation.printingId !== 'string' ||
    mutation.printingId.length === 0 ||
    !validLocation(mutation.from) ||
    !validLocation(mutation.to)
  ) {
    throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
  }
  const card = takeCardAt(ledger, mutation.from);
  if (card.printingId !== mutation.printingId) {
    throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
  }
  putCardAt(ledger, mutation.to, card);
}

function ledgerCards(ledger: BattleCardLedger): BattleCardIdentity[] {
  const cards: BattleCardIdentity[] = [];
  for (const player of [0, 1] as const) {
    const current = ledger.players[player];
    cards.push(...current.deck, ...current.hand, ...current.trash, ...current.ap);
    cards.push(...current.characters);
    cards.push(...current.equipment.filter(
      (card): card is BattleCardIdentity => card !== null,
    ));
  }
  if (ledger.field) cards.push(ledger.field);
  return cards;
}

function sameCardList(cards: readonly BattleCardIdentity[], printingIds: readonly string[]): boolean {
  return cards.length === printingIds.length &&
    cards.every((card, index) => card.printingId === printingIds[index]);
}

function assertBattleCardLedger(
  state: BattleState,
  ledger: BattleCardLedger,
  catalog: readonly BattleCardIdentity[],
): void {
  if (
    !plainObject(ledger) ||
    !exactKeys(ledger, ['players', 'field'], ['players', 'field']) ||
    !Array.isArray(ledger.players) ||
    ledger.players.length !== 2 ||
    !Array.isArray(catalog)
  ) {
    throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
  }

  const expected = new Map<BattleCardId, BattleCardIdentity>();
  for (const card of catalog) {
    const battleCardId = parseBattleCardId(card?.battleCardId);
    if (
      !battleCardId ||
      typeof card.printingId !== 'string' ||
      card.printingId.length === 0 ||
      !playerValue(card.owner) ||
      expected.has(battleCardId)
    ) {
      throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
    }
    expected.set(battleCardId, card);
  }

  for (const player of [0, 1] as const) {
    const cards = ledger.players[player];
    const current = state.players[player];
    if (
      !plainObject(cards) ||
      !exactKeys(
        cards,
        ['deck', 'hand', 'trash', 'ap', 'characters', 'equipment'],
        ['deck', 'hand', 'trash', 'ap', 'characters', 'equipment'],
      ) ||
      !Array.isArray(cards.deck) ||
      !Array.isArray(cards.hand) ||
      !Array.isArray(cards.trash) ||
      !Array.isArray(cards.ap) ||
      !Array.isArray(cards.characters) ||
      !Array.isArray(cards.equipment) ||
      !sameCardList(cards.deck, current.deck) ||
      !sameCardList(cards.hand, current.hand) ||
      !sameCardList(cards.trash, current.trash) ||
      !sameCardList(cards.ap, current.ap) ||
      !sameCardList(cards.characters, current.characters.map((character) => character.cardId)) ||
      cards.equipment.length !== current.characters.length ||
      [
        ...cards.deck,
        ...cards.hand,
        ...cards.trash,
        ...cards.ap,
        ...cards.characters,
        ...cards.equipment.filter(
          (card): card is BattleCardIdentity => card !== null,
        ),
      ].some((card) => card.owner !== player) ||
      cards.equipment.some(
        (card, slot) => card?.printingId !== (current.characters[slot]?.equipmentCardId ?? undefined),
      )
    ) {
      throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
    }
  }
  if (
    (ledger.field === null) !== (state.field === null) ||
    (ledger.field !== null &&
      (ledger.field.printingId !== state.field?.cardId || ledger.field.owner !== state.field.owner))
  ) {
    throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
  }

  const seen = new Set<BattleCardId>();
  for (const card of ledgerCards(ledger)) {
    const battleCardId = parseBattleCardId(card?.battleCardId);
    const original = battleCardId ? expected.get(battleCardId) : undefined;
    if (
      !battleCardId ||
      !original ||
      seen.has(battleCardId) ||
      card.printingId !== original.printingId ||
      card.owner !== original.owner
    ) {
      throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
    }
    seen.add(battleCardId);
  }
  if (seen.size !== expected.size) {
    throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
  }
}

function battleCardIdentityHash(ledger: BattleCardLedger): string {
  return `i1-${fingerprintOf(ledger)}`;
}

function immutableCatalogFromLedger(
  state: BattleState,
  ledger: BattleCardLedger,
): readonly BattleCardIdentity[] {
  try {
    const catalog = Object.freeze(
      ledgerCards(ledger).map((card) => Object.freeze({ ...card })),
    );
    assertBattleCardLedger(state, ledger, catalog);
    return catalog;
  } catch {
    throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
  }
}

function validateVersionValues(versions: EngineBattleVersions): void {
  if (!plainObject(versions)) throw new EngineBattleAdapterError('BATTLE_SETUP_INVALID');
  if (
    versions.adapterVersion !== ENGINE_BATTLE_ADAPTER_VERSION ||
    versions.engineVersion !== ENGINE_VERSION ||
    versions.contentVersion !== CONTENT_VERSION ||
    versions.npcPolicyId !== G1_NPC_POLICY_ID
  ) {
    throw new EngineBattleAdapterError('BATTLE_VERSION_MISMATCH');
  }
  if (typeof versions.formatVersionId !== 'string') {
    throw new EngineBattleAdapterError('BATTLE_SETUP_INVALID');
  }
}

function validateCreateVersions(versions: EngineBattleVersions): void {
  if (!plainObject(versions) || !exactKeys(versions, VERSION_KEYS, VERSION_KEYS)) {
    throw new EngineBattleAdapterError('BATTLE_SETUP_INVALID');
  }
  validateVersionValues(versions);
}

function exactLegalEngineAction(state: BattleState, raw: unknown): BattleAction | null {
  let cloned: unknown;
  try {
    cloned = structuredClone(raw);
  } catch {
    return null;
  }
  const parsed = parseInternalBattleAction(cloned);
  if (!parsed) return null;
  const identity = stableStringify(parsed);
  return legalActions(state).find((candidate) => stableStringify(candidate) === identity) ?? null;
}

function handIndexForBattleCard(
  state: BattleState,
  battleCards: BattleCardLedger,
  player: PlayerIndex,
  battleCardId: BattleCardId,
): number | null {
  const matches: number[] = [];
  battleCards.players[player].hand.forEach((card, index) => {
    if (card.battleCardId === battleCardId) matches.push(index);
  });
  if (matches.length !== 1) return null;
  const index = matches[0]!;
  return state.players[player].hand[index] ===
    battleCards.players[player].hand[index]?.printingId
    ? index
    : null;
}

function engineActionFromMatchAction(
  state: BattleState,
  battleCards: BattleCardLedger,
  player: PlayerIndex,
  action: MatchAction,
): BattleAction | null {
  const handIndex = 'battleCardId' in action
    ? handIndexForBattleCard(state, battleCards, player, action.battleCardId)
    : null;
  switch (action.type) {
    case 'playSkill':
      return handIndex === null
        ? null
        : {
            type: action.type,
            handIndex,
            ...(action.healTargetSlot === undefined
              ? {}
              : { healTargetIndex: action.healTargetSlot }),
            ...(action.targetSlot === undefined ? {} : { targetIndex: action.targetSlot }),
            ...(action.usingCharacterSlot === undefined
              ? {}
              : { usingIndex: action.usingCharacterSlot }),
          };
    case 'playCharacter':
    case 'playField':
    case 'playGuard':
    case 'charge':
      return handIndex === null ? null : { type: action.type, handIndex };
    case 'playEquipment':
      return handIndex === null
        ? null
        : {
            type: action.type,
            handIndex,
            targetIndex: action.targetCharacterSlot,
          };
    case 'turnStartAbility':
      return { type: action.type, charIndex: action.characterSlot };
    case 'skipTurnStart':
    case 'endPlay':
    case 'pass':
    case 'endTurn':
      return { type: action.type };
  }
}

/** engine-native actionを現在の全zone台帳からstable MatchActionへ変換する内部bridge。 */
export function matchActionFromEngineAction(
  state: BattleState,
  battleCards: BattleCardLedger,
  player: PlayerIndex,
  rawAction: unknown,
): MatchAction {
  if (!playerValue(player)) {
    throw new EngineBattleAdapterError('BATTLE_ACTION_INVALID');
  }
  try {
    assertBattleCardLedger(
      state,
      battleCards,
      ledgerCards(battleCards).map((card) => Object.freeze({ ...card })),
    );
  } catch {
    throw new EngineBattleAdapterError('BATTLE_ACTION_INVALID');
  }
  const action = parseInternalBattleAction(rawAction);
  if (!action) throw new EngineBattleAdapterError('BATTLE_ACTION_INVALID');
  const cardAt = (handIndex: number): BattleCardIdentity => {
    const card = battleCards.players[player]?.hand[handIndex];
    if (
      !card ||
      card.owner !== player ||
      parseBattleCardId(card.battleCardId) === null ||
      state.players[player]?.hand[handIndex] !== card.printingId
    ) {
      throw new EngineBattleAdapterError('BATTLE_ACTION_INVALID');
    }
    return card;
  };
  switch (action.type) {
    case 'playSkill':
      return {
        type: action.type,
        battleCardId: cardAt(action.handIndex).battleCardId,
        ...(action.healTargetIndex === undefined
          ? {}
          : { healTargetSlot: action.healTargetIndex }),
        ...(action.targetIndex === undefined ? {} : { targetSlot: action.targetIndex }),
        ...(action.usingIndex === undefined
          ? {}
          : { usingCharacterSlot: action.usingIndex }),
      };
    case 'playCharacter':
    case 'playField':
    case 'playGuard':
    case 'charge':
      return { type: action.type, battleCardId: cardAt(action.handIndex).battleCardId };
    case 'playEquipment':
      return {
        type: action.type,
        battleCardId: cardAt(action.handIndex).battleCardId,
        targetCharacterSlot: action.targetIndex,
      };
    case 'turnStartAbility':
      return { type: action.type, characterSlot: action.charIndex };
    case 'skipTurnStart':
    case 'endPlay':
    case 'pass':
    case 'endTurn':
      return { type: action.type };
  }
}

function exactLegalMatchAction(
  state: BattleState,
  battleCards: BattleCardLedger,
  player: PlayerIndex,
  raw: unknown,
): { matchAction: MatchAction; engineAction: BattleAction } | null {
  let cloned: unknown;
  try {
    cloned = structuredClone(raw);
  } catch {
    return null;
  }
  const matchAction = parseMatchAction(cloned);
  if (!matchAction) return null;
  const engineAction = engineActionFromMatchAction(state, battleCards, player, matchAction);
  if (!engineAction) return null;
  const identity = stableStringify(engineAction);
  const legal = legalActions(state).find(
    (candidate) => stableStringify(candidate) === identity,
  );
  return legal ? { matchAction, engineAction: legal } : null;
}

function eventsSince(state: BattleState, previousSequence: number): BattleEvent[] {
  if (
    !Number.isSafeInteger(previousSequence) ||
    previousSequence < 0 ||
    !Number.isSafeInteger(state.eventSeq) ||
    state.eventSeq < previousSequence ||
    !Array.isArray(state.events)
  ) {
    throw new EngineBattleAdapterError('BATTLE_ENGINE_FAILURE');
  }
  const count = state.eventSeq - previousSequence;
  if (count === 0) return [];
  // engineは直近300件だけをstateに保持する。1 actionの増分がそれを越えた場合、
  // 不完全なevent列を成功として返さずtrial全体をrollbackする。
  if (count > state.events.length) {
    throw new EngineBattleAdapterError('BATTLE_ENGINE_FAILURE');
  }
  return structuredClone(state.events.slice(-count));
}

function completeInitialEvents(state: BattleState): BattleEvent[] {
  if (
    !Number.isSafeInteger(state.eventSeq) ||
    state.eventSeq < 0 ||
    !Array.isArray(state.events) ||
    state.eventSeq !== state.events.length
  ) {
    throw new EngineBattleAdapterError('BATTLE_ENGINE_FAILURE');
  }
  return structuredClone(state.events);
}

function statusOf(
  state: BattleState,
  battleCards: BattleCardLedger,
  steps: readonly AppliedBattleStep[],
): NpcBattleStatus {
  return {
    phase: state.phase,
    turn: state.turn,
    actingPlayer: state.phase === 'finished' ? null : actingPlayer(state),
    winner: state.winner,
    endReason: state.endReason,
    stateHash: stateHash(state),
    identityHash: battleCardIdentityHash(battleCards),
    appliedActions: steps.length,
  };
}

function currentVersions(formatId: string): EngineBattleVersions {
  return {
    adapterVersion: ENGINE_BATTLE_ADAPTER_VERSION,
    engineVersion: ENGINE_VERSION,
    contentVersion: CONTENT_VERSION,
    formatVersionId: formatId,
    npcPolicyId: G1_NPC_POLICY_ID,
  };
}

/** G1固定fixture。browserからdeck/seed/versionを受け取らずserver側だけで組み立てる。 */
export function g1NpcBattleInput(seed: number): CreateNpcBattleInput {
  if (!validSeed(seed)) throw new EngineBattleAdapterError('BATTLE_SETUP_INVALID');
  const standard = sampleArchetypeDecks();
  const human = standard[0]?.deck;
  const npc = standard[1]?.deck;
  if (!human || !npc) throw new EngineBattleAdapterError('BATTLE_SETUP_INVALID');
  return {
    seed,
    versions: currentVersions(formatVersionId(DEFAULT_FORMAT)),
    decks: [cloneDeck(human), cloneDeck(npc)],
  };
}

/**
 * engine公開APIだけを使うMatchDO内部runtime。
 * 毎actionをcloneへ適用し、NPC pump全体が成功した時だけ権威stateを差し替える。
 */
export class EngineBattleAdapter {
  private constructor(
    private headerValue: AuthoritativeBattleHeader,
    private initialEventsValue: BattleEvent[],
    private readonly initialBattleCardsValue: BattleCardLedger,
    private readonly initialIdentityHashValue: string,
    private stateValue: BattleState,
    private battleCardsValue: BattleCardLedger,
    private readonly battleCardCatalogValue: readonly BattleCardIdentity[],
    private stepsValue: AppliedBattleStep[],
  ) {}

  static create(
    input: CreateNpcBattleInput,
    generateBattleCardId: BattleCardIdGenerator = randomBattleCardId,
  ): EngineBattleAdapter {
    if (
      !plainObject(input) ||
      !exactKeys(input, ['seed', 'versions', 'decks'], ['seed', 'versions', 'decks']) ||
      !validSeed(input.seed) ||
      !validDeckPair(input.decks)
    ) {
      throw new EngineBattleAdapterError('BATTLE_SETUP_INVALID');
    }
    validateCreateVersions(input.versions);
    const format = formatByVersionId(input.versions.formatVersionId);
    if (!format) throw new EngineBattleAdapterError('BATTLE_FORMAT_UNKNOWN');
    if (formatVersionId(format) !== input.versions.formatVersionId) {
      throw new EngineBattleAdapterError('BATTLE_VERSION_MISMATCH');
    }

    const decks = cloneDecks(input.decks);
    let decksAreLegal = false;
    try {
      decksAreLegal = decks.every((deck) => checkDeckForMatchStart(deck, format).legal);
    } catch {
      decksAreLegal = false;
    }
    if (!decksAreLegal) {
      throw new EngineBattleAdapterError('BATTLE_DECK_INVALID');
    }

    let state: BattleState;
    try {
      state = createBattle(decks, input.seed, {
        format,
        manualFor: HUMAN_PLAYER,
      });
    } catch {
      throw new EngineBattleAdapterError('BATTLE_ENGINE_FAILURE');
    }
    const header: AuthoritativeBattleHeader = {
      ...input.versions,
      seed: input.seed,
      firstPlayer: state.firstPlayer,
      firstPlayerFromSeed: true,
      humanPlayer: HUMAN_PLAYER,
      manualFor: HUMAN_PLAYER,
      decks: cloneDecks(decks),
    };
    const initialEvents = completeInitialEvents(state);
    const { ledger, catalog } = createBattleCardLedger(state, generateBattleCardId);
    assertBattleCardLedger(state, ledger, catalog);
    const initialBattleCards = structuredClone(ledger);
    const initialIdentityHash = battleCardIdentityHash(initialBattleCards);
    const adapter = new EngineBattleAdapter(
      header,
      initialEvents,
      initialBattleCards,
      initialIdentityHash,
      state,
      ledger,
      catalog,
      [],
    );
    adapter.pumpNpcIntoAuthoritativeState();
    return adapter;
  }

  /**
   * 初期ID配置とstable stepからruntimeを再演する。CSPRNG再採番と自動NPC pumpは行わない。
   * OLG-125ではこの結果を同一transactionのcurrent snapshot/hashと照合してから復旧する。
   */
  static restoreFromHistory(rawInput: unknown): EngineBattleAdapter {
    let input: RestoreNpcBattleHistoryInput;
    try {
      input = structuredClone(rawInput) as RestoreNpcBattleHistoryInput;
    } catch {
      throw new EngineBattleAdapterError('BATTLE_RUNTIME_INVALID');
    }
    if (
      !plainObject(input) ||
      !exactKeys(input, RESTORE_HISTORY_KEYS, RESTORE_HISTORY_KEYS) ||
      !plainObject(input.header) ||
      !exactKeys(input.header, HEADER_KEYS, HEADER_KEYS) ||
      !Array.isArray(input.steps) ||
      typeof input.initialIdentityHash !== 'string'
    ) {
      throw new EngineBattleAdapterError('BATTLE_RUNTIME_INVALID');
    }
    try {
      validateVersionValues(input.header);
    } catch {
      throw new EngineBattleAdapterError('BATTLE_RUNTIME_INVALID');
    }
    if (
      !validSeed(input.header.seed) ||
      !validDeckPair(input.header.decks) ||
      input.header.humanPlayer !== HUMAN_PLAYER ||
      input.header.manualFor !== HUMAN_PLAYER ||
      input.header.firstPlayerFromSeed !== true
    ) {
      throw new EngineBattleAdapterError('BATTLE_RUNTIME_INVALID');
    }
    const format = formatByVersionId(input.header.formatVersionId);
    if (!format || formatVersionId(format) !== input.header.formatVersionId) {
      throw new EngineBattleAdapterError('BATTLE_RUNTIME_INVALID');
    }

    let state: BattleState;
    try {
      state = createBattle(cloneDecks(input.header.decks), input.header.seed, {
        format,
        manualFor: HUMAN_PLAYER,
      });
    } catch {
      throw new EngineBattleAdapterError('BATTLE_RUNTIME_INVALID');
    }
    if (state.firstPlayer !== input.header.firstPlayer) {
      throw new EngineBattleAdapterError('BATTLE_RUNTIME_INVALID');
    }
    const initialBattleCards = structuredClone(input.initialBattleCards);
    const catalog = immutableCatalogFromLedger(state, initialBattleCards);
    if (battleCardIdentityHash(initialBattleCards) !== input.initialIdentityHash) {
      throw new EngineBattleAdapterError('BATTLE_IDENTITY_INVALID');
    }
    const adapter = new EngineBattleAdapter(
      structuredClone(input.header),
      completeInitialEvents(state),
      structuredClone(initialBattleCards),
      input.initialIdentityHash,
      state,
      structuredClone(initialBattleCards),
      catalog,
      [],
    );

    for (const [sequence, expected] of input.steps.entries()) {
      if (
        !plainObject(expected) ||
        !exactKeys(expected, APPLIED_STEP_KEYS, APPLIED_STEP_KEYS) ||
        expected.sequence !== sequence ||
        !playerValue(expected.player) ||
        (expected.source !== 'human' && expected.source !== 'npc') ||
        (expected.source === 'human' && expected.player !== HUMAN_PLAYER) ||
        (expected.source === 'npc' && expected.player !== NPC_PLAYER) ||
        typeof expected.stateHash !== 'string' ||
        typeof expected.identityHash !== 'string' ||
        !Array.isArray(expected.events) ||
        state.phase === 'finished' ||
        actingPlayer(state) !== expected.player
      ) {
        throw new EngineBattleAdapterError('BATTLE_RUNTIME_INVALID');
      }
      const resolved = exactLegalMatchAction(
        state,
        adapter.battleCardsValue,
        expected.player,
        expected.action,
      );
      if (!resolved) throw new EngineBattleAdapterError('BATTLE_RUNTIME_INVALID');
      adapter.applyStep(
        state,
        adapter.battleCardsValue,
        adapter.stepsValue,
        expected.player,
        expected.source,
        resolved.matchAction,
        resolved.engineAction,
      );
      const actual = adapter.stepsValue[sequence];
      if (!actual || stableStringify(actual) !== stableStringify(expected)) {
        throw new EngineBattleAdapterError('BATTLE_RUNTIME_INVALID');
      }
    }
    // create/applyはNPC pump全体を1 transactionに含めるため、途中prefixは復旧点にならない。
    if (state.phase !== 'finished' && actingPlayer(state) !== HUMAN_PLAYER) {
      throw new EngineBattleAdapterError('BATTLE_RUNTIME_INVALID');
    }
    adapter.assertRuntime();
    return adapter;
  }

  applyHumanAction(rawAction: unknown): AppliedBattleTransition {
    this.assertRuntime();
    if (this.stateValue.phase === 'finished') {
      throw new EngineBattleAdapterError('BATTLE_ALREADY_FINISHED');
    }
    if (actingPlayer(this.stateValue) !== HUMAN_PLAYER) {
      throw new EngineBattleAdapterError('BATTLE_NOT_HUMAN_TURN');
    }
    const action = exactLegalMatchAction(
      this.stateValue,
      this.battleCardsValue,
      HUMAN_PLAYER,
      rawAction,
    );
    if (!action) throw new EngineBattleAdapterError('BATTLE_ACTION_INVALID');

    const trialState = structuredClone(this.stateValue);
    const trialBattleCards = structuredClone(this.battleCardsValue);
    const trialSteps = structuredClone(this.stepsValue);
    const firstNewStep = trialSteps.length;
    let preparedTransition: AppliedBattleTransition;
    try {
      this.applyStep(
        trialState,
        trialBattleCards,
        trialSteps,
        HUMAN_PLAYER,
        'human',
        action.matchAction,
        action.engineAction,
      );
      this.pumpNpc(trialState, trialBattleCards, trialSteps);
      preparedTransition = {
        steps: structuredClone(trialSteps.slice(firstNewStep)),
        status: statusOf(trialState, trialBattleCards, trialSteps),
      };
    } catch (error) {
      if (error instanceof EngineBattleAdapterError) throw error;
      throw new EngineBattleAdapterError('BATTLE_ENGINE_FAILURE');
    }

    this.stateValue = trialState;
    this.battleCardsValue = trialBattleCards;
    this.stepsValue = trialSteps;
    return preparedTransition;
  }

  authoritativeSnapshot(): AuthoritativeBattleSnapshot {
    this.assertRuntime();
    return structuredClone({
      header: this.headerValue,
      initialEvents: this.initialEventsValue,
      initialBattleCards: this.initialBattleCardsValue,
      initialIdentityHash: this.initialIdentityHashValue,
      state: this.stateValue,
      battleCards: this.battleCardsValue,
      steps: this.stepsValue,
      currentStateHash: stateHash(this.stateValue),
      currentIdentityHash: battleCardIdentityHash(this.battleCardsValue),
    });
  }

  status(): NpcBattleStatus {
    this.assertRuntime();
    return statusOf(this.stateValue, this.battleCardsValue, this.stepsValue);
  }

  /** player command単位のrevision。NPC pump内のstep数とは分離する。 */
  commandRevision(): number {
    this.assertRuntime();
    return this.stepsValue.reduce(
      (revision, step) => revision + (step.source === 'human' ? 1 : 0),
      0,
    );
  }

  result(): NpcBattleResult | null {
    const status = this.status();
    if (status.phase !== 'finished' || status.endReason === null) return null;
    return {
      winner: status.winner,
      endReason: status.endReason,
      turns: status.turn,
      finalStateHash: status.stateHash,
      finalIdentityHash: status.identityHash,
      appliedActions: status.appliedActions,
    };
  }

  private assertRuntime(): void {
    try {
      validateVersionValues(this.headerValue);
    } catch {
      throw new EngineBattleAdapterError('BATTLE_RUNTIME_INVALID');
    }
    if (
      !plainObject(this.headerValue) ||
      !exactKeys(this.headerValue, HEADER_KEYS, HEADER_KEYS) ||
      !validSeed(this.headerValue.seed) ||
      !validDeckPair(this.headerValue.decks) ||
      this.headerValue.humanPlayer !== HUMAN_PLAYER ||
      this.headerValue.manualFor !== HUMAN_PLAYER ||
      this.headerValue.firstPlayerFromSeed !== true ||
      this.stateValue.firstPlayer !== this.headerValue.firstPlayer ||
      this.stateValue.manualFor !== HUMAN_PLAYER ||
      !Array.isArray(this.initialEventsValue) ||
      !Array.isArray(this.stepsValue) ||
      battleCardIdentityHash(this.initialBattleCardsValue) !== this.initialIdentityHashValue
    ) {
      throw new EngineBattleAdapterError('BATTLE_RUNTIME_INVALID');
    }
    assertBattleCardLedger(
      this.stateValue,
      this.battleCardsValue,
      this.battleCardCatalogValue,
    );
  }

  private pumpNpcIntoAuthoritativeState(): void {
    const trialState = structuredClone(this.stateValue);
    const trialBattleCards = structuredClone(this.battleCardsValue);
    const trialSteps = structuredClone(this.stepsValue);
    try {
      this.pumpNpc(trialState, trialBattleCards, trialSteps);
    } catch (error) {
      if (error instanceof EngineBattleAdapterError) throw error;
      throw new EngineBattleAdapterError('BATTLE_ENGINE_FAILURE');
    }
    this.stateValue = trialState;
    this.battleCardsValue = trialBattleCards;
    this.stepsValue = trialSteps;
  }

  private pumpNpc(
    state: BattleState,
    battleCards: BattleCardLedger,
    steps: AppliedBattleStep[],
  ): void {
    const npc = searchAi({ keepHand: 2 });
    let actions = 0;
    while (state.phase !== 'finished' && actingPlayer(state) === NPC_PLAYER) {
      actions += 1;
      if (actions > MAX_NPC_ACTIONS_PER_TRANSITION) {
        throw new EngineBattleAdapterError('BATTLE_NPC_WATCHDOG_EXCEEDED');
      }
      const selected = npc.choose(state, NPC_PLAYER);
      const engineAction = exactLegalEngineAction(state, selected);
      if (!engineAction) throw new EngineBattleAdapterError('BATTLE_ENGINE_FAILURE');
      const matchAction = matchActionFromEngineAction(
        state,
        battleCards,
        NPC_PLAYER,
        engineAction,
      );
      this.applyStep(
        state,
        battleCards,
        steps,
        NPC_PLAYER,
        'npc',
        matchAction,
        engineAction,
      );
    }
  }

  private applyStep(
    state: BattleState,
    battleCards: BattleCardLedger,
    steps: AppliedBattleStep[],
    player: PlayerIndex,
    source: AppliedBattleStep['source'],
    matchAction: MatchAction,
    engineAction: BattleAction,
  ): void {
    if (state.phase === 'finished' || actingPlayer(state) !== player) {
      throw new EngineBattleAdapterError('BATTLE_ENGINE_FAILURE');
    }
    const previousEventSequence = state.eventSeq;
    const mutations = applyActionWithCardTrace(state, engineAction);
    if (!Array.isArray(mutations)) {
      throw new EngineBattleAdapterError('BATTLE_ENGINE_FAILURE');
    }
    for (const mutation of mutations) applyBattleCardMutation(battleCards, mutation);
    assertBattleCardLedger(state, battleCards, this.battleCardCatalogValue);
    steps.push({
      sequence: steps.length,
      player,
      source,
      action: structuredClone(matchAction),
      stateHash: stateHash(state),
      identityHash: battleCardIdentityHash(battleCards),
      events: eventsSince(state, previousEventSequence),
    });
  }
}
