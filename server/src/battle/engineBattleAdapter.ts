import {
  CONTENT_VERSION,
  DEFAULT_FORMAT,
  ENGINE_VERSION,
  actingPlayer,
  applyAction,
  checkDeckForMatchStart,
  createBattle,
  formatByVersionId,
  formatVersionId,
  legalActions,
  sampleArchetypeDecks,
  searchAi,
  stableStringify,
  stateHash,
  type BattleAction,
  type BattleEvent,
  type BattleState,
  type DeckList,
  type EndReason,
  type PlayerIndex,
} from '@bravers/engine';

export const ENGINE_BATTLE_ADAPTER_VERSION = 1 as const;
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
  action: BattleAction;
  stateHash: string;
  events: BattleEvent[];
}

/**
 * MatchDO内部だけで扱う権威snapshot。
 * 相手hand/deck/rngStateを含むため、OLG-124のprojection前にwireへ出してはいけない。
 */
export interface AuthoritativeBattleSnapshot {
  header: AuthoritativeBattleHeader;
  /** createBattle直後・NPC先攻pump前に発生した、欠落のない初期event列。 */
  initialEvents: BattleEvent[];
  state: BattleState;
  steps: AppliedBattleStep[];
  currentStateHash: string;
}

export interface NpcBattleStatus {
  phase: BattleState['phase'];
  turn: number;
  actingPlayer: PlayerIndex | null;
  winner: PlayerIndex | null;
  endReason: EndReason | null;
  stateHash: string;
  appliedActions: number;
}

export interface NpcBattleResult {
  winner: PlayerIndex | null;
  endReason: EndReason;
  turns: number;
  finalStateHash: string;
  appliedActions: number;
}

export interface AppliedBattleTransition {
  steps: AppliedBattleStep[];
  status: NpcBattleStatus;
}

const ACTION_KEYS: Record<BattleAction['type'], readonly string[]> = {
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

/** engine-native actionのstrictなserver内部decoder。wire公開はOLG-123まで行わない。 */
export function parseInternalBattleAction(value: unknown): BattleAction | null {
  if (!plainObject(value) || typeof value.type !== 'string') return null;
  const type = value.type as BattleAction['type'];
  if (!Object.hasOwn(ACTION_KEYS, type)) return null;
  const allowed = ACTION_KEYS[type];

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

function exactLegalAction(state: BattleState, raw: unknown): BattleAction | null {
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

function statusOf(state: BattleState, steps: readonly AppliedBattleStep[]): NpcBattleStatus {
  return {
    phase: state.phase,
    turn: state.turn,
    actingPlayer: state.phase === 'finished' ? null : actingPlayer(state),
    winner: state.winner,
    endReason: state.endReason,
    stateHash: stateHash(state),
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
    private stateValue: BattleState,
    private stepsValue: AppliedBattleStep[],
  ) {}

  static create(input: CreateNpcBattleInput): EngineBattleAdapter {
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
    const adapter = new EngineBattleAdapter(header, initialEvents, state, []);
    adapter.pumpNpcIntoAuthoritativeState();
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
    const action = exactLegalAction(this.stateValue, rawAction);
    if (!action) throw new EngineBattleAdapterError('BATTLE_ACTION_INVALID');

    const trialState = structuredClone(this.stateValue);
    const trialSteps = structuredClone(this.stepsValue);
    const firstNewStep = trialSteps.length;
    try {
      this.applyStep(trialState, trialSteps, HUMAN_PLAYER, 'human', action);
      this.pumpNpc(trialState, trialSteps);
    } catch (error) {
      if (error instanceof EngineBattleAdapterError) throw error;
      throw new EngineBattleAdapterError('BATTLE_ENGINE_FAILURE');
    }

    this.stateValue = trialState;
    this.stepsValue = trialSteps;
    return {
      steps: structuredClone(trialSteps.slice(firstNewStep)),
      status: statusOf(trialState, trialSteps),
    };
  }

  authoritativeSnapshot(): AuthoritativeBattleSnapshot {
    this.assertRuntime();
    return structuredClone({
      header: this.headerValue,
      initialEvents: this.initialEventsValue,
      state: this.stateValue,
      steps: this.stepsValue,
      currentStateHash: stateHash(this.stateValue),
    });
  }

  status(): NpcBattleStatus {
    this.assertRuntime();
    return statusOf(this.stateValue, this.stepsValue);
  }

  result(): NpcBattleResult | null {
    const status = this.status();
    if (status.phase !== 'finished' || status.endReason === null) return null;
    return {
      winner: status.winner,
      endReason: status.endReason,
      turns: status.turn,
      finalStateHash: status.stateHash,
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
      !Array.isArray(this.stepsValue)
    ) {
      throw new EngineBattleAdapterError('BATTLE_RUNTIME_INVALID');
    }
  }

  private pumpNpcIntoAuthoritativeState(): void {
    const trialState = structuredClone(this.stateValue);
    const trialSteps = structuredClone(this.stepsValue);
    try {
      this.pumpNpc(trialState, trialSteps);
    } catch (error) {
      if (error instanceof EngineBattleAdapterError) throw error;
      throw new EngineBattleAdapterError('BATTLE_ENGINE_FAILURE');
    }
    this.stateValue = trialState;
    this.stepsValue = trialSteps;
  }

  private pumpNpc(state: BattleState, steps: AppliedBattleStep[]): void {
    const npc = searchAi({ keepHand: 2 });
    let actions = 0;
    while (state.phase !== 'finished' && actingPlayer(state) === NPC_PLAYER) {
      actions += 1;
      if (actions > MAX_NPC_ACTIONS_PER_TRANSITION) {
        throw new EngineBattleAdapterError('BATTLE_NPC_WATCHDOG_EXCEEDED');
      }
      const selected = npc.choose(state, NPC_PLAYER);
      const action = exactLegalAction(state, selected);
      if (!action) throw new EngineBattleAdapterError('BATTLE_ENGINE_FAILURE');
      this.applyStep(state, steps, NPC_PLAYER, 'npc', action);
    }
  }

  private applyStep(
    state: BattleState,
    steps: AppliedBattleStep[],
    player: PlayerIndex,
    source: AppliedBattleStep['source'],
    action: BattleAction,
  ): void {
    if (state.phase === 'finished' || actingPlayer(state) !== player) {
      throw new EngineBattleAdapterError('BATTLE_ENGINE_FAILURE');
    }
    const previousEventSequence = state.eventSeq;
    applyAction(state, action);
    steps.push({
      sequence: steps.length,
      player,
      source,
      action: structuredClone(action),
      stateHash: stateHash(state),
      events: eventsSince(state, previousEventSequence),
    });
  }
}
