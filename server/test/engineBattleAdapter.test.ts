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
  type BattleState,
} from '@bravers/engine';
import { parseBattleCardId, type BattleCardId, type MatchAction } from '@bravers/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  EngineBattleAdapter,
  EngineBattleAdapterError,
  HUMAN_PLAYER,
  NPC_PLAYER,
  g1NpcBattleInput,
  matchActionFromEngineAction,
  parseMatchAction,
  type BattleCardIdentity,
  type BattleCardLedger,
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

function applyDirectStep(state: BattleState, action: BattleAction): void {
  applyAction(state, action);
}

function pumpDirectNpc(state: BattleState): number {
  const npc = searchAi({ keepHand: 2 });
  let steps = 0;
  let safety = 0;
  while (state.phase !== 'finished' && actingPlayer(state) === NPC_PLAYER) {
    safety += 1;
    if (safety > 512) throw new Error('direct NPC watchdog exceeded');
    applyDirectStep(state, npc.choose(state, NPC_PLAYER));
    steps += 1;
  }
  return steps;
}

function allBattleCards(ledger: BattleCardLedger): BattleCardIdentity[] {
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

function sequentialBattleCardIds(start = 0): () => string {
  let next = start;
  return () => `bc_${(next++).toString(16).padStart(32, '0')}`;
}

function parsedId(value: string): BattleCardId {
  const parsed = parseBattleCardId(value);
  if (!parsed) throw new Error(`Invalid test battleCardId: ${value}`);
  return parsed;
}

function stableHumanAction(adapter: EngineBattleAdapter, engineAction: BattleAction): MatchAction {
  const snapshot = adapter.authoritativeSnapshot();
  return matchActionFromEngineAction(
    snapshot.state,
    snapshot.battleCards,
    HUMAN_PLAYER,
    engineAction,
  );
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
  let expectedSteps = pumpDirectNpc(direct);
  const initialSnapshot = adapter.authoritativeSnapshot();
  let expectedRevision = 0;
  expect(adapter.commandRevision()).toBe(expectedRevision);
  expect(initialSnapshot.initialEvents).toEqual(initialEvents);
  expect(initialSnapshot.steps).toHaveLength(expectedSteps);
  expect(initialSnapshot.state).toEqual(direct);
  expect(initialSnapshot.steps.every((step) => parseMatchAction(step.action) !== null)).toBe(true);
  expect(initialSnapshot.steps.some((step) => 'handIndex' in step.action)).toBe(false);

  let safety = 0;
  while (direct.phase !== 'finished') {
    safety += 1;
    if (safety > 1_000) throw new Error('direct battle watchdog exceeded');
    expect(actingPlayer(direct)).toBe(HUMAN_PLAYER);
    const engineAction = human.choose(direct, HUMAN_PLAYER);
    const matchAction = stableHumanAction(adapter, engineAction);
    applyDirectStep(direct, engineAction);
    const firstNewStep = expectedSteps;
    expectedSteps += 1;
    expectedSteps += pumpDirectNpc(direct);
    const transition = adapter.applyHumanAction(matchAction);
    expectedRevision += 1;
    expect(adapter.commandRevision()).toBe(expectedRevision);
    const snapshot = adapter.authoritativeSnapshot();
    expect(transition.steps).toHaveLength(expectedSteps - firstNewStep);
    expect(transition.steps[0]?.action).toEqual(matchAction);
    expect(transition.steps.some((step) => 'handIndex' in step.action)).toBe(false);
    expect(transition.status.stateHash).toBe(stateHash(direct));
    expect(snapshot.state).toEqual(direct);
    expect(snapshot.steps).toHaveLength(expectedSteps);
    expect(snapshot.currentStateHash).toBe(stateHash(direct));
    expect(snapshot.currentIdentityHash).toBe(transition.status.identityHash);
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
      finalIdentityHash: adapter.authoritativeSnapshot().currentIdentityHash,
      appliedActions: adapter.authoritativeSnapshot().steps.length,
    });
    expect(adapter.result()?.endReason).toMatch(/^(wipeout|deckout)$/);
  });

  it('同seedのengine stateは一致するがbattleCardIdは試合ごとに異なり、snapshot変更は戻らない', () => {
    const input = g1NpcBattleInput(42);
    const first = EngineBattleAdapter.create(input);
    const second = EngineBattleAdapter.create(structuredClone(input));
    const initial = first.authoritativeSnapshot();
    const other = second.authoritativeSnapshot();
    expect(initial.header).toEqual(other.header);
    expect(initial.state).toEqual(other.state);
    expect(initial.currentStateHash).toBe(other.currentStateHash);
    expect(initial.currentIdentityHash).not.toBe(other.currentIdentityHash);
    const firstIds = new Set(allBattleCards(initial.battleCards).map((card) => card.battleCardId));
    const secondIds = new Set(allBattleCards(other.battleCards).map((card) => card.battleCardId));
    expect([...firstIds].some((id) => secondIds.has(id))).toBe(false);
    expect(initial.header.firstPlayer).toBe(NPC_PLAYER);
    expect(initial.steps.length).toBeGreaterThan(0);
    expect(initial.steps[0]).toMatchObject({ player: NPC_PLAYER, source: 'npc' });

    const leaked = first.authoritativeSnapshot();
    leaked.state.turn = 999;
    leaked.header.decks[0].cardIds.length = 0;
    leaked.initialBattleCards.players[0].hand[0]!.printingId = 'tampered-initial';
    leaked.battleCards.players[0].hand[0]!.printingId = 'tampered';
    leaked.steps.push({} as never);
    const after = first.authoritativeSnapshot();
    expect(after.state.turn).not.toBe(999);
    expect(after.header.decks[0].cardIds).toHaveLength(40);
    expect(after.initialBattleCards.players[0].hand[0]?.printingId).not.toBe('tampered-initial');
    expect(after.battleCards.players[0].hand[0]?.printingId).not.toBe('tampered');
    expect(after.steps).not.toContainEqual({});
  });

  it('strict schemaとlegalActions完全一致を通らないactionは盤面不変で拒否する', () => {
    const adapter = EngineBattleAdapter.create(g1NpcBattleInput(0));
    const before = adapter.authoritativeSnapshot();
    const legal = legalActions(before.state)[0];
    if (!legal) throw new Error('Expected legal human action');
    const stable = matchActionFromEngineAction(
      before.state,
      before.battleCards,
      HUMAN_PLAYER,
      legal,
    );

    expect(parseMatchAction({ ...stable, unexpected: true })).toBeNull();
    const rejected: unknown[] = [
      { type: 'unknown' },
      { type: 'charge', handIndex: -1 },
      { type: 'charge', battleCardId: 'bc_invalid' },
      { ...stable, handIndex: 0 },
      { ...stable, unexpected: true },
    ];
    for (const action of rejected) {
      expectAdapterError(
        () => adapter.applyHumanAction(action),
        'BATTLE_ACTION_INVALID',
      );
      expect(adapter.authoritativeSnapshot()).toEqual(before);
    }
  });

  it('prepareはcurrent runtimeを変えず、commit後に採用できる次runtimeとcheckpointを返す', () => {
    const adapter = EngineBattleAdapter.create(g1NpcBattleInput(0));
    const before = adapter.authoritativeSnapshot();
    const engineAction = legalActions(before.state)[0];
    if (!engineAction) throw new Error('Expected legal human action');
    const action = stableHumanAction(adapter, engineAction);

    const prepared = adapter.prepareHumanAction(action);
    expect(adapter.authoritativeSnapshot()).toEqual(before);
    expect(adapter.commandRevision()).toBe(0);
    expect(prepared.nextRuntime.commandRevision()).toBe(1);
    expect(prepared.transition.steps[0]).toMatchObject({ source: 'human' });
    const preparedSnapshot = prepared.nextRuntime.authoritativeSnapshot();
    expect(prepared.nextRuntime.authoritativeCheckpoint()).toEqual({
      state: preparedSnapshot.state,
      battleCards: preparedSnapshot.battleCards,
      stepCount: preparedSnapshot.steps.length,
      currentStateHash: preparedSnapshot.currentStateHash,
      currentIdentityHash: preparedSnapshot.currentIdentityHash,
    });

    const directlyApplied = adapter.applyHumanAction(action);
    expect(directlyApplied).toEqual(prepared.transition);
    expect(adapter.authoritativeSnapshot()).toEqual(preparedSnapshot);
  });

  it('MatchAction union全枝をstrict decodeし、旧index・欠落・型違い・余剰keyを拒否する', () => {
    const battleCardId = parsedId('bc_00112233445566778899aabbccddeeff');
    const accepted: MatchAction[] = [
      { type: 'playSkill', battleCardId },
      {
        type: 'playSkill',
        battleCardId,
        healTargetSlot: 0,
        targetSlot: 1,
        usingCharacterSlot: 2,
      },
      { type: 'playCharacter', battleCardId },
      { type: 'playEquipment', battleCardId, targetCharacterSlot: 1 },
      { type: 'playField', battleCardId },
      { type: 'turnStartAbility', characterSlot: 0 },
      { type: 'skipTurnStart' },
      { type: 'endPlay' },
      { type: 'playGuard', battleCardId },
      { type: 'pass' },
      { type: 'charge', battleCardId },
      { type: 'endTurn' },
    ];
    for (const action of accepted) {
      expect(parseMatchAction(action)).toEqual(action);
    }

    const rejected: unknown[] = [
      { type: 'playSkill' },
      { type: 'playSkill', battleCardId, targetSlot: -1 },
      { type: 'playCharacter', battleCardId: 1 },
      { type: 'playEquipment', battleCardId },
      { type: 'playField', battleCardId, handIndex: 0 },
      { type: 'turnStartAbility', characterSlot: 0.5 },
      { type: 'skipTurnStart', extra: true },
      { type: 'endPlay', battleCardId },
      { type: 'playGuard' },
      { type: 'pass', extra: true },
      { type: 'charge', battleCardId: 'bc_0' },
      { type: 'endTurn', extra: true },
    ];
    for (const action of rejected) {
      expect(parseMatchAction(action)).toBeNull();
    }
  });

  it('human適用後に例外が起きてもtrialをcommitせずsnapshotを完全rollbackする', () => {
    const adapter = EngineBattleAdapter.create(g1NpcBattleInput(0));
    const before = adapter.authoritativeSnapshot();
    const engineAction = legalActions(before.state)[0];
    if (!engineAction) throw new Error('Expected legal human action');
    const action = matchActionFromEngineAction(
      before.state,
      before.battleCards,
      HUMAN_PLAYER,
      engineAction,
    );

    const nativeStructuredClone = globalThis.structuredClone.bind(globalThis);
    let actionCloneCount = 0;
    const cloneSpy = vi.spyOn(globalThis, 'structuredClone').mockImplementation((value) => {
      if (
        value !== null &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'battleCardId')
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
    expect(actionCloneCount).toBe(2);
    expect(adapter.authoritativeSnapshot()).toEqual(before);
  });

  it('transition返却値の生成に失敗してもtrialをcommitしない', () => {
    const adapter = EngineBattleAdapter.create(g1NpcBattleInput(0));
    const before = adapter.authoritativeSnapshot();
    const engineAction = legalActions(before.state)[0];
    if (!engineAction) throw new Error('Expected legal human action');
    const action = stableHumanAction(adapter, engineAction);

    const nativeStructuredClone = globalThis.structuredClone.bind(globalThis);
    const cloneSpy = vi.spyOn(globalThis, 'structuredClone').mockImplementation((value) => {
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((step) => (
          step !== null &&
          typeof step === 'object' &&
          Object.hasOwn(step, 'source') &&
          Object.hasOwn(step, 'sequence')
        ))
      ) {
        throw new Error('injected while preparing transition');
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
    expect(adapter.commandRevision()).toBe(0);
  });

  it('1 human command内でNPCが複数step進んでもcommandRevisionは1だけ増える', () => {
    const adapter = EngineBattleAdapter.create(g1NpcBattleInput(0));
    const human = searchAi({ keepHand: 2 });
    let witness: {
      beforeRevision: number;
      afterRevision: number;
      npcSteps: number;
    } | null = null;

    for (let safety = 0; safety < 256 && adapter.result() === null; safety += 1) {
      const snapshot = adapter.authoritativeSnapshot();
      expect(actingPlayer(snapshot.state)).toBe(HUMAN_PLAYER);
      const beforeRevision = adapter.commandRevision();
      const engineAction = human.choose(snapshot.state, HUMAN_PLAYER);
      const transition = adapter.applyHumanAction(stableHumanAction(adapter, engineAction));
      const afterRevision = adapter.commandRevision();
      const humanSteps = transition.steps.filter((step) => step.source === 'human');
      const npcSteps = transition.steps.filter((step) => step.source === 'npc').length;

      expect(humanSteps).toHaveLength(1);
      expect(afterRevision).toBe(beforeRevision + 1);
      if (npcSteps >= 2) {
        witness = { beforeRevision, afterRevision, npcSteps };
        break;
      }
    }

    if (!witness) throw new Error('Expected deterministic multi-step NPC witness');
    expect(witness.npcSteps).toBeGreaterThanOrEqual(2);
    expect(witness.afterRevision).toBe(witness.beforeRevision + 1);
  });

  it('全カードへ128-bit IDを一意に割り当て、重複printingも別個体として保持する', () => {
    const input = g1NpcBattleInput(0);
    const adapter = EngineBattleAdapter.create(input, sequentialBattleCardIds());
    const snapshot = adapter.authoritativeSnapshot();
    const cards = allBattleCards(snapshot.battleCards);
    const expectedCount = input.decks.reduce(
      (count, deck) => count + deck.cardIds.length + deck.characterIds.length,
      0,
    );
    expect(cards).toHaveLength(expectedCount);
    expect(new Set(cards.map((card) => card.battleCardId)).size).toBe(expectedCount);
    expect(cards.every((card) => /^bc_[0-9a-f]{32}$/.test(card.battleCardId))).toBe(true);
    expect(cards.every((card) => card.battleCardId !== card.printingId)).toBe(true);

    const duplicatePrinting = new Map<string, BattleCardIdentity[]>();
    for (const card of cards) {
      const group = duplicatePrinting.get(card.printingId) ?? [];
      group.push(card);
      duplicatePrinting.set(card.printingId, group);
    }
    const duplicate = [...duplicatePrinting.values()].find((group) => group.length > 1);
    expect(duplicate).toBeDefined();
    expect(new Set(duplicate?.map((card) => card.battleCardId)).size).toBe(duplicate?.length);
    expect(snapshot.currentIdentityHash).toMatch(/^i1-[0-9a-f]{16}$/);

    const same = EngineBattleAdapter.create(input, sequentialBattleCardIds());
    expect(same.authoritativeSnapshot()).toEqual(snapshot);
  });

  it('初期ID配置とstable stepだけからCSPRNG再採番なしで同じruntimeを再演する', () => {
    const original = EngineBattleAdapter.create(
      g1NpcBattleInput(42),
      sequentialBattleCardIds(),
    );
    const beforeAction = original.authoritativeSnapshot();
    const engineAction = legalActions(beforeAction.state)[0];
    if (!engineAction) throw new Error('Expected legal action for replay fixture');
    original.applyHumanAction(stableHumanAction(original, engineAction));
    const saved = original.authoritativeSnapshot();

    const restored = EngineBattleAdapter.restoreFromHistory({
      header: saved.header,
      initialBattleCards: saved.initialBattleCards,
      initialIdentityHash: saved.initialIdentityHash,
      steps: saved.steps,
    });
    expect(restored.authoritativeSnapshot()).toEqual(saved);
    expect(restored.commandRevision()).toBe(original.commandRevision());
    expect(saved.initialIdentityHash).toMatch(/^i1-[0-9a-f]{16}$/);
    expect(saved.initialBattleCards).toEqual(beforeAction.initialBattleCards);
  });

  it('履歴復旧は初期ID配置・hash・stable stepの改変をfail closedにする', () => {
    const original = EngineBattleAdapter.create(
      g1NpcBattleInput(42),
      sequentialBattleCardIds(),
    );
    const saved = original.authoritativeSnapshot();
    expect(saved.steps.length).toBeGreaterThan(0);

    const tamperedInitial = structuredClone(saved);
    tamperedInitial.initialBattleCards.players[HUMAN_PLAYER].hand[0]!.battleCardId = parsedId(
      'bc_fffffffffffffffffffffffffffffffe',
    );
    expectAdapterError(
      () => EngineBattleAdapter.restoreFromHistory({
        header: tamperedInitial.header,
        initialBattleCards: tamperedInitial.initialBattleCards,
        initialIdentityHash: tamperedInitial.initialIdentityHash,
        steps: tamperedInitial.steps,
      }),
      'BATTLE_IDENTITY_INVALID',
    );

    const tamperedStep = structuredClone(saved);
    tamperedStep.steps[0]!.identityHash = 'i1-0000000000000000';
    expectAdapterError(
      () => EngineBattleAdapter.restoreFromHistory({
        header: tamperedStep.header,
        initialBattleCards: tamperedStep.initialBattleCards,
        initialIdentityHash: tamperedStep.initialIdentityHash,
        steps: tamperedStep.steps,
      }),
      'BATTLE_RUNTIME_INVALID',
    );

    const truncatedNpcPump = structuredClone(saved);
    truncatedNpcPump.steps.pop();
    expectAdapterError(
      () => EngineBattleAdapter.restoreFromHistory({
        header: truncatedNpcPump.header,
        initialBattleCards: truncatedNpcPump.initialBattleCards,
        initialIdentityHash: truncatedNpcPump.initialIdentityHash,
        steps: truncatedNpcPump.steps,
      }),
      'BATTLE_RUNTIME_INVALID',
    );

    expectAdapterError(
      () => EngineBattleAdapter.restoreFromHistory({
        header: saved.header,
        initialBattleCards: saved.initialBattleCards,
        initialIdentityHash: saved.initialIdentityHash,
        steps: saved.steps,
        extra: true,
      }),
      'BATTLE_RUNTIME_INVALID',
    );
  });

  it('ID generatorの形式違反・衝突を開始前にfail closedにする', () => {
    const input = g1NpcBattleInput(0);
    expectAdapterError(
      () => EngineBattleAdapter.create(input, () => 'bc_invalid'),
      'BATTLE_IDENTITY_INVALID',
    );
    expectAdapterError(
      () => EngineBattleAdapter.create(
        input,
        () => 'bc_00112233445566778899aabbccddeeff',
      ),
      'BATTLE_IDENTITY_INVALID',
    );
    expectAdapterError(
      () => EngineBattleAdapter.create(input, () => {
        throw new Error('generator failure');
      }),
      'BATTLE_IDENTITY_INVALID',
    );
  });

  it('hand indexが詰まっても保存済みIDで正しい個体を選び、stale・他owner・別zoneを拒否する', () => {
    const adapter = EngineBattleAdapter.create(g1NpcBattleInput(0), sequentialBattleCardIds());
    expect(adapter.authoritativeSnapshot().state.phase).toBe('play');
    adapter.applyHumanAction({ type: 'endPlay' });
    const charge = adapter.authoritativeSnapshot();
    expect(charge.state.phase).toBe('charge');
    expect(charge.battleCards.players[HUMAN_PLAYER].hand.length).toBeGreaterThan(3);
    const first = charge.battleCards.players[HUMAN_PLAYER].hand[0]!;
    const selected = charge.battleCards.players[HUMAN_PLAYER].hand[3]!;

    adapter.applyHumanAction({ type: 'charge', battleCardId: first.battleCardId });
    const shifted = adapter.authoritativeSnapshot();
    expect(
      shifted.battleCards.players[HUMAN_PLAYER].hand.findIndex(
        (card) => card.battleCardId === selected.battleCardId,
      ),
    ).toBe(2);
    expect(
      shifted.battleCards.players[HUMAN_PLAYER].ap.some(
        (card) => card.battleCardId === first.battleCardId,
      ),
    ).toBe(true);

    const opponent = shifted.battleCards.players[NPC_PLAYER].hand[0]!.battleCardId;
    const ownDeck = shifted.battleCards.players[HUMAN_PLAYER].deck[0]!.battleCardId;
    const unknown = parsedId('bc_ffffffffffffffffffffffffffffffff');
    for (const battleCardId of [first.battleCardId, opponent, ownDeck, unknown]) {
      expectAdapterError(
        () => adapter.applyHumanAction({ type: 'charge', battleCardId }),
        'BATTLE_ACTION_INVALID',
      );
      expect(adapter.authoritativeSnapshot()).toEqual(shifted);
    }

    const applied = adapter.applyHumanAction({
      type: 'charge',
      battleCardId: selected.battleCardId,
    });
    expect(applied.steps[0]?.action).toEqual({
      type: 'charge',
      battleCardId: selected.battleCardId,
    });
    const after = adapter.authoritativeSnapshot();
    expect(after.currentIdentityHash).not.toBe(shifted.currentIdentityHash);
    expect(
      after.battleCards.players[HUMAN_PLAYER].ap.some(
        (card) => card.battleCardId === selected.battleCardId &&
          card.printingId === selected.printingId,
      ),
    ).toBe(true);
  });

  it('公開engine→MatchAction bridgeも破損owner・ID・範囲外indexをfail closedにする', () => {
    const adapter = EngineBattleAdapter.create(g1NpcBattleInput(0), sequentialBattleCardIds());
    const snapshot = adapter.authoritativeSnapshot();
    const engineAction = legalActions(snapshot.state).find((action) => 'handIndex' in action);
    if (!engineAction || !('handIndex' in engineAction)) {
      throw new Error('Expected hand action');
    }
    const valid = matchActionFromEngineAction(
      snapshot.state,
      snapshot.battleCards,
      HUMAN_PLAYER,
      engineAction,
    );
    expect(parseMatchAction(valid)).toEqual(valid);

    const wrongOwner = structuredClone(snapshot.battleCards);
    wrongOwner.players[HUMAN_PLAYER].hand[engineAction.handIndex]!.owner = NPC_PLAYER;
    expectAdapterError(
      () => matchActionFromEngineAction(
        snapshot.state,
        wrongOwner,
        HUMAN_PLAYER,
        engineAction,
      ),
      'BATTLE_ACTION_INVALID',
    );

    const malformedId = structuredClone(snapshot.battleCards);
    malformedId.players[HUMAN_PLAYER].hand[engineAction.handIndex]!.battleCardId =
      'bc_invalid' as BattleCardId;
    expectAdapterError(
      () => matchActionFromEngineAction(
        snapshot.state,
        malformedId,
        HUMAN_PLAYER,
        engineAction,
      ),
      'BATTLE_ACTION_INVALID',
    );
    expectAdapterError(
      () => matchActionFromEngineAction(
        snapshot.state,
        snapshot.battleCards,
        HUMAN_PLAYER,
        { ...engineAction, handIndex: 9_999 },
      ),
      'BATTLE_ACTION_INVALID',
    );
  });

  it('台帳のID重複・printing改変をcatalog照合で検出する', () => {
    const duplicate = EngineBattleAdapter.create(g1NpcBattleInput(0), sequentialBattleCardIds());
    const duplicateTarget = duplicate as unknown as { battleCardsValue: BattleCardLedger };
    duplicateTarget.battleCardsValue.players[HUMAN_PLAYER].hand[1]!.battleCardId =
      duplicateTarget.battleCardsValue.players[HUMAN_PLAYER].hand[0]!.battleCardId;
    expectAdapterError(
      () => duplicate.authoritativeSnapshot(),
      'BATTLE_IDENTITY_INVALID',
    );

    const printing = EngineBattleAdapter.create(g1NpcBattleInput(0), sequentialBattleCardIds());
    const printingTarget = printing as unknown as { battleCardsValue: BattleCardLedger };
    printingTarget.battleCardsValue.players[HUMAN_PLAYER].hand[0]!.printingId = 'tampered';
    expectAdapterError(
      () => printing.authoritativeSnapshot(),
      'BATTLE_IDENTITY_INVALID',
    );
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
