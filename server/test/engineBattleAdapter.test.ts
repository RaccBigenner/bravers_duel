import {
  DEFAULT_FORMAT,
  actingPlayer,
  applyAction,
  createBattle,
  formatByVersionId,
  legalActions,
  searchAi,
  stateHash,
  type BattleAction,
  type BattleEvent,
  type BattleState,
  type PlayerIndex,
} from '@bravers/engine';
import { describe, expect, it, vi } from 'vitest';
import {
  EngineBattleAdapter,
  EngineBattleAdapterError,
  HUMAN_PLAYER,
  NPC_PLAYER,
  g1NpcBattleInput,
  parseInternalBattleAction,
  type AppliedBattleStep,
  type CreateNpcBattleInput,
} from '../src/battle/engineBattleAdapter';

function expectAdapterError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error('Expected EngineBattleAdapterError');
  } catch (error) {
    expect(error).toBeInstanceOf(EngineBattleAdapterError);
    expect((error as EngineBattleAdapterError).code).toBe(code);
  }
}

function applyDirectStep(
  state: BattleState,
  player: PlayerIndex,
  source: AppliedBattleStep['source'],
  action: BattleAction,
  sequence: number,
): AppliedBattleStep {
  const previousEventSequence = state.eventSeq;
  applyAction(state, action);
  const eventCount = state.eventSeq - previousEventSequence;
  if (eventCount < 0 || eventCount > state.events.length) {
    throw new Error('direct event stream gap');
  }
  return {
    sequence,
    player,
    source,
    action: structuredClone(action),
    stateHash: stateHash(state),
    events: eventCount === 0
      ? []
      : structuredClone(state.events.slice(-eventCount)),
  };
}

function pumpDirectNpc(state: BattleState, firstSequence: number): AppliedBattleStep[] {
  const npc = searchAi({ keepHand: 2 });
  const steps: AppliedBattleStep[] = [];
  let safety = 0;
  while (state.phase !== 'finished' && actingPlayer(state) === NPC_PLAYER) {
    safety += 1;
    if (safety > 512) throw new Error('direct NPC watchdog exceeded');
    const action = npc.choose(state, NPC_PLAYER);
    steps.push(applyDirectStep(
      state,
      NPC_PLAYER,
      'npc',
      action,
      firstSequence + steps.length,
    ));
  }
  return steps;
}

function finishWithDirectEngine(
  adapter: EngineBattleAdapter,
  input: CreateNpcBattleInput,
): { adapterState: BattleState; directState: BattleState } {
  const format = formatByVersionId(input.versions.formatVersionId);
  if (!format) throw new Error('Expected format');
  const direct = createBattle(input.decks, input.seed, {
    format,
    manualFor: HUMAN_PLAYER,
  });
  const human = searchAi({ keepHand: 2 });
  const initialEvents = structuredClone(direct.events);
  const expectedSteps = pumpDirectNpc(direct, 0);
  const initialSnapshot = adapter.authoritativeSnapshot();
  expect(initialSnapshot.initialEvents).toEqual(initialEvents);
  expect(initialSnapshot.steps).toEqual(expectedSteps);
  expect(initialSnapshot.state).toEqual(direct);

  let safety = 0;
  while (direct.phase !== 'finished') {
    safety += 1;
    if (safety > 1_000) throw new Error('direct battle watchdog exceeded');
    expect(actingPlayer(direct)).toBe(HUMAN_PLAYER);
    const action = human.choose(direct, HUMAN_PLAYER);
    const transitionSteps = [
      applyDirectStep(direct, HUMAN_PLAYER, 'human', action, expectedSteps.length),
    ];
    transitionSteps.push(...pumpDirectNpc(direct, expectedSteps.length + 1));
    expectedSteps.push(...transitionSteps);
    const transition = adapter.applyHumanAction(action);
    const snapshot = adapter.authoritativeSnapshot();
    expect(transition.steps).toEqual(transitionSteps);
    expect(transition.status.stateHash).toBe(stateHash(direct));
    expect(snapshot.state).toEqual(direct);
    expect(snapshot.steps).toEqual(expectedSteps);
    expect(snapshot.currentStateHash).toBe(stateHash(direct));
  }
  const snapshot = adapter.authoritativeSnapshot();
  const completeEvents = [
    ...snapshot.initialEvents,
    ...snapshot.steps.flatMap((step) => step.events),
  ];
  expect(completeEvents).toHaveLength(snapshot.state.eventSeq);
  expect(completeEvents.slice(-snapshot.state.events.length)).toEqual(snapshot.state.events);
  return { adapterState: adapter.authoritativeSnapshot().state, directState: direct };
}

describe('OLG-121 engine battle adapter', () => {
  it('G1固定fixtureを同seedでengine単体と同じ全state・最終結果まで進める', () => {
    const input = g1NpcBattleInput(20_260_801);
    const adapter = EngineBattleAdapter.create(input);
    const { adapterState, directState } = finishWithDirectEngine(adapter, input);

    expect(adapterState).toEqual(directState);
    expect(adapter.result()).toEqual({
      winner: directState.winner,
      endReason: directState.endReason,
      turns: directState.turn,
      finalStateHash: stateHash(directState),
      appliedActions: adapter.authoritativeSnapshot().steps.length,
    });
    expect(adapter.result()?.endReason).toMatch(/^(wipeout|deckout)$/);
  });

  it('同じ入力はNPC先攻pumpを含め完全一致し、snapshot変更は権威stateへ戻らない', () => {
    const input = g1NpcBattleInput(42);
    const first = EngineBattleAdapter.create(input);
    const second = EngineBattleAdapter.create(structuredClone(input));
    expect(first.authoritativeSnapshot()).toEqual(second.authoritativeSnapshot());
    const initial = first.authoritativeSnapshot();
    expect(initial.header.firstPlayer).toBe(NPC_PLAYER);
    expect(initial.steps.length).toBeGreaterThan(0);
    expect(initial.steps[0]).toMatchObject({ player: NPC_PLAYER, source: 'npc' });

    const leaked = first.authoritativeSnapshot();
    leaked.state.turn = 999;
    leaked.header.decks[0].cardIds.length = 0;
    leaked.steps.push({} as never);
    const after = first.authoritativeSnapshot();
    expect(after.state.turn).not.toBe(999);
    expect(after.header.decks[0].cardIds).toHaveLength(40);
    expect(after.steps).not.toContainEqual({});
  });

  it('strict schemaとlegalActions完全一致を通らないactionは盤面不変で拒否する', () => {
    const adapter = EngineBattleAdapter.create(g1NpcBattleInput(0));
    const before = adapter.authoritativeSnapshot();
    const legal = legalActions(before.state)[0];
    if (!legal) throw new Error('Expected legal human action');

    expect(parseInternalBattleAction({ ...legal, unexpected: true })).toBeNull();
    const rejected: unknown[] = [
      { type: 'unknown' },
      { type: 'charge', handIndex: -1 },
      { type: 'charge', handIndex: 0.5 },
      { ...legal, unexpected: true },
    ];
    for (const action of rejected) {
      expectAdapterError(
        () => adapter.applyHumanAction(action),
        'BATTLE_ACTION_INVALID',
      );
      expect(adapter.authoritativeSnapshot()).toEqual(before);
    }
  });

  it('engine action union全枝をstrict decodeし、欠落・型違い・余剰keyを拒否する', () => {
    const accepted: BattleAction[] = [
      { type: 'playSkill', handIndex: 0 },
      { type: 'playSkill', handIndex: 1, healTargetIndex: 0, targetIndex: 1, usingIndex: 2 },
      { type: 'playCharacter', handIndex: 0 },
      { type: 'playEquipment', handIndex: 0, targetIndex: 1 },
      { type: 'playField', handIndex: 0 },
      { type: 'turnStartAbility', charIndex: 0 },
      { type: 'skipTurnStart' },
      { type: 'endPlay' },
      { type: 'playGuard', handIndex: 0 },
      { type: 'pass' },
      { type: 'charge', handIndex: 0 },
      { type: 'endTurn' },
    ];
    for (const action of accepted) {
      expect(parseInternalBattleAction(action)).toEqual(action);
    }

    const rejected: unknown[] = [
      { type: 'playSkill' },
      { type: 'playSkill', handIndex: 0, targetIndex: -1 },
      { type: 'playCharacter', handIndex: '0' },
      { type: 'playEquipment', handIndex: 0 },
      { type: 'playField', handIndex: Number.NaN },
      { type: 'turnStartAbility', charIndex: 0.5 },
      { type: 'skipTurnStart', extra: true },
      { type: 'endPlay', handIndex: 0 },
      { type: 'playGuard' },
      { type: 'pass', extra: true },
      { type: 'charge', handIndex: -1 },
      { type: 'endTurn', extra: true },
    ];
    for (const action of rejected) {
      expect(parseInternalBattleAction(action)).toBeNull();
    }
  });

  it('human適用後に例外が起きてもtrialをcommitせずsnapshotを完全rollbackする', () => {
    const adapter = EngineBattleAdapter.create(g1NpcBattleInput(0));
    const before = adapter.authoritativeSnapshot();
    const action = legalActions(before.state)[0];
    if (!action) throw new Error('Expected legal human action');

    const nativeStructuredClone = globalThis.structuredClone.bind(globalThis);
    let actionCloneCount = 0;
    const cloneSpy = vi.spyOn(globalThis, 'structuredClone').mockImplementation((value) => {
      if (
        value !== null &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'type')
      ) {
        actionCloneCount += 1;
        if (actionCloneCount === 2) throw new Error('injected after engine mutation');
      }
      return nativeStructuredClone(value);
    });

    let thrown: unknown;
    try {
      adapter.applyHumanAction(action);
    } catch (error) {
      thrown = error;
    } finally {
      cloneSpy.mockRestore();
    }
    expect(thrown).toBeInstanceOf(EngineBattleAdapterError);
    expect((thrown as EngineBattleAdapterError).code).toBe('BATTLE_ENGINE_FAILURE');
    expect(adapter.authoritativeSnapshot()).toEqual(before);
  });

  it('版・format・deckの不一致を開始前にfail closedにする', () => {
    const base = g1NpcBattleInput(99);
    const wrongEngine = structuredClone(base);
    wrongEngine.versions.engineVersion = 'tampered';
    expectAdapterError(
      () => EngineBattleAdapter.create(wrongEngine),
      'BATTLE_VERSION_MISMATCH',
    );

    const unknownFormat = structuredClone(base);
    unknownFormat.versions.formatVersionId = 'UNKNOWN@1';
    expectAdapterError(
      () => EngineBattleAdapter.create(unknownFormat),
      'BATTLE_FORMAT_UNKNOWN',
    );

    const illegalDeck = structuredClone(base);
    illegalDeck.decks[0].cardIds.pop();
    expectAdapterError(
      () => EngineBattleAdapter.create(illegalDeck),
      'BATTLE_DECK_INVALID',
    );

    expectAdapterError(
      () => EngineBattleAdapter.create({ ...base, extra: true } as never),
      'BATTLE_SETUP_INVALID',
    );
    expectAdapterError(
      () => EngineBattleAdapter.create({
        ...base,
        versions: { ...base.versions, extra: true },
      } as never),
      'BATTLE_SETUP_INVALID',
    );
  });

  it('終了後のactionを専用理由で拒否する', () => {
    const adapter = EngineBattleAdapter.create(g1NpcBattleInput(0));
    finishWithDirectEngine(adapter, g1NpcBattleInput(0));
    expectAdapterError(
      () => adapter.applyHumanAction({ type: 'endPlay' }),
      'BATTLE_ALREADY_FINISHED',
    );
  });

  it('既定formatは明示した版と一致し、client fallbackに依存しない', () => {
    const input = g1NpcBattleInput(1);
    expect(input.versions.formatVersionId).toBe(
      `${DEFAULT_FORMAT.formatId}@${DEFAULT_FORMAT.version}`,
    );
  });
});
