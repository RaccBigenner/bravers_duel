import { describe, expect, it } from 'vitest';
import { searchAi } from '../src/ai';
import {
  actingPlayer,
  applyActionWithCardTrace,
  createBattle,
  type BattleState,
  type PlayerIndex,
} from '../src/battle';
import type {
  BattleCardArrayZone,
  BattleCardLocation,
  BattleCardMutation,
} from '../src/battleCardTrace';
import { ALL_CARDS } from '../src/cards';
import type { DeckList } from '../src/decks';
import { sampleArchetypeDecks } from '../src/sampleDecks';

const VANILLA_ATK = '1-A129-C';
const EQUIPMENT_A = '1-A025-SR';
const EQUIPMENT_B = '1-A026-SR';
const FIELD_A = '1-A035-R';
const FIELD_B = '1-A036-R';
const SEARCH_SKILL = '1-A111-UC';
const ROLLBACK_SKILL = '1-A109-UC';

interface ShadowCard {
  key: string;
  printingId: string;
}

interface ShadowPlayer {
  deck: ShadowCard[];
  hand: ShadowCard[];
  trash: ShadowCard[];
  ap: ShadowCard[];
  equipment: Array<ShadowCard | null>;
}

interface ShadowState {
  players: [ShadowPlayer, ShadowPlayer];
  field: ShadowCard | null;
  initialKeys: Set<string>;
}

function shadowOf(state: BattleState): ShadowState {
  let sequence = 0;
  const card = (printingId: string, label: string): ShadowCard => ({
    key: `${label}-${sequence++}`,
    printingId,
  });
  const players = state.players.map((player, playerIndex) => ({
    deck: player.deck.map((id, i) => card(id, `p${playerIndex}-deck-${i}`)),
    hand: player.hand.map((id, i) => card(id, `p${playerIndex}-hand-${i}`)),
    trash: player.trash.map((id, i) => card(id, `p${playerIndex}-trash-${i}`)),
    ap: player.ap.map((id, i) => card(id, `p${playerIndex}-ap-${i}`)),
    equipment: player.characters.map((character, i) =>
      character.equipmentCardId === null
        ? null
        : card(character.equipmentCardId, `p${playerIndex}-equipment-${i}`),
    ),
  })) as [ShadowPlayer, ShadowPlayer];
  const field = state.field === null ? null : card(state.field.cardId, 'field');
  const shadow: ShadowState = { players, field, initialKeys: new Set() };
  shadow.initialKeys = new Set(allShadowCards(shadow).map((entry) => entry.key));
  return shadow;
}

function shadowArray(
  shadow: ShadowState,
  player: PlayerIndex,
  zone: BattleCardArrayZone,
): ShadowCard[] {
  return shadow.players[player][zone];
}

function removeShadowCard(shadow: ShadowState, location: BattleCardLocation): ShadowCard {
  switch (location.type) {
    case 'array': {
      const [removed] = shadowArray(shadow, location.player, location.zone).splice(location.index, 1);
      expect(removed, `remove ${location.player}.${location.zone}[${location.index}]`).toBeDefined();
      return removed!;
    }
    case 'equipment': {
      const removed = shadow.players[location.player].equipment[location.characterSlot];
      expect(removed, `remove equipment ${location.player}[${location.characterSlot}]`).not.toBeNull();
      shadow.players[location.player].equipment[location.characterSlot] = null;
      return removed!;
    }
    case 'field': {
      const removed = shadow.field;
      expect(removed, 'remove field').not.toBeNull();
      shadow.field = null;
      return removed!;
    }
  }
}

function insertShadowCard(
  shadow: ShadowState,
  location: BattleCardLocation,
  entry: ShadowCard,
): void {
  switch (location.type) {
    case 'array':
      shadowArray(shadow, location.player, location.zone).splice(location.index, 0, entry);
      return;
    case 'equipment':
      expect(shadow.players[location.player].equipment[location.characterSlot]).toBeNull();
      shadow.players[location.player].equipment[location.characterSlot] = entry;
      return;
    case 'field':
      expect(shadow.field).toBeNull();
      shadow.field = entry;
      return;
  }
}

function applyMutation(shadow: ShadowState, mutation: BattleCardMutation): void {
  if (mutation.type === 'swap') {
    const deck = shadow.players[mutation.player].deck;
    expect(deck[mutation.leftIndex]).toBeDefined();
    expect(deck[mutation.rightIndex]).toBeDefined();
    [deck[mutation.leftIndex], deck[mutation.rightIndex]] = [
      deck[mutation.rightIndex],
      deck[mutation.leftIndex],
    ];
    return;
  }

  const entry = removeShadowCard(shadow, mutation.from);
  expect(entry.printingId).toBe(mutation.printingId);
  insertShadowCard(shadow, mutation.to, entry);
}

function allShadowCards(shadow: ShadowState): ShadowCard[] {
  return [
    ...shadow.players.flatMap((player) => [
      ...player.deck,
      ...player.hand,
      ...player.trash,
      ...player.ap,
      ...player.equipment.filter((entry): entry is ShadowCard => entry !== null),
    ]),
    ...(shadow.field ? [shadow.field] : []),
  ];
}

function expectShadowToMatch(state: BattleState, shadow: ShadowState): void {
  for (const player of [0, 1] as const) {
    for (const zone of ['deck', 'hand', 'trash', 'ap'] as const) {
      expect(shadow.players[player][zone].map((entry) => entry.printingId)).toEqual(
        state.players[player][zone],
      );
    }
    expect(shadow.players[player].equipment.map((entry) => entry?.printingId ?? null)).toEqual(
      state.players[player].characters.map((character) => character.equipmentCardId),
    );
  }
  expect(shadow.field?.printingId ?? null).toBe(state.field?.cardId ?? null);

  const cards = allShadowCards(shadow);
  const currentKeys = new Set(cards.map((entry) => entry.key));
  expect(currentKeys.size).toBe(cards.length);
  expect(currentKeys).toEqual(shadow.initialKeys);
}

function applyAndMirror(
  state: BattleState,
  shadow: ShadowState,
  action: Parameters<typeof applyActionWithCardTrace>[1],
): BattleCardMutation[] {
  const mutations = applyActionWithCardTrace(state, action);
  mutations.forEach((mutation) => applyMutation(shadow, mutation));
  expectShadowToMatch(state, shadow);
  return mutations;
}

function characterWith(attribute: string): string {
  const found = ALL_CARDS.find(
    (card) => card.type === 'character' && card.attribute.includes(attribute as never),
  );
  if (!found) throw new Error(`${attribute}属性のキャラクターがありません`);
  return found.printingId;
}

function testBattle(characterId: string, deckCard = VANILLA_ATK): BattleState {
  const deck = (char: string): DeckList => ({
    characterIds: [char],
    cardIds: Array(20).fill(deckCard),
  });
  return createBattle([deck(characterId), deck(characterWith('斬'))], 17, {
    firstPlayer: 0,
    validate: false,
  });
}

describe('battle card movement trace', () => {
  it('同じprintingの複数コピーから、指定indexの個体だけを移す', () => {
    const state = testBattle(characterWith('斬'));
    const shadow = shadowOf(state);

    applyAndMirror(state, shadow, { type: 'endPlay' });
    const selected = shadow.players[0].hand[2].key;
    const destinationIndex = shadow.players[0].ap.length;
    const mutations = applyAndMirror(state, shadow, { type: 'charge', handIndex: 2 });

    expect(mutations).toEqual([
      {
        type: 'move',
        printingId: VANILLA_ATK,
        from: { type: 'array', player: 0, zone: 'hand', index: 2 },
        to: { type: 'array', player: 0, zone: 'ap', index: destinationIndex },
      },
    ]);
    expect(shadow.players[0].ap[destinationIndex].key).toBe(selected);
  });

  it('searchで選んだ個体と、その後のdeck shuffleを順番どおり記録する', () => {
    const state = testBattle(characterWith('補'), SEARCH_SKILL);
    state.players[0].hand = [SEARCH_SKILL];
    state.players[0].deck = [
      EQUIPMENT_A,
      VANILLA_ATK,
      EQUIPMENT_B,
      FIELD_A,
      VANILLA_ATK,
      FIELD_B,
    ];
    state.players[0].trash = [];
    state.players[0].ap = [];
    const shadow = shadowOf(state);
    const searchedKey = shadow.players[0].deck[1].key;

    const mutations = applyAndMirror(state, shadow, { type: 'playSkill', handIndex: 0 });
    const searchMove = mutations.find(
      (mutation) =>
        mutation.type === 'move' &&
        mutation.from.type === 'array' &&
        mutation.from.zone === 'deck' &&
        mutation.to.type === 'array' &&
        mutation.to.zone === 'hand',
    );

    expect(searchMove).toEqual({
      type: 'move',
      printingId: VANILLA_ATK,
      from: { type: 'array', player: 0, zone: 'deck', index: 1 },
      to: { type: 'array', player: 0, zone: 'hand', index: 0 },
    });
    expect(mutations.filter((mutation) => mutation.type === 'swap')).toHaveLength(4);
    expect(shadow.players[0].hand[0].key).toBe(searchedKey);
  });

  it('equipmentとfieldの付け替えをsingleton location込みで記録する', () => {
    const state = testBattle(characterWith('斬'));
    state.players[0].hand = [EQUIPMENT_A, EQUIPMENT_B, FIELD_A, FIELD_B];
    state.players[0].trash = [];
    state.players[0].ap = [];
    const shadow = shadowOf(state);

    const firstEquipment = applyAndMirror(state, shadow, {
      type: 'playEquipment',
      handIndex: 0,
      targetIndex: 0,
    });
    expect(firstEquipment[0]?.type === 'move' ? firstEquipment[0].to : null).toEqual({
      type: 'equipment',
      player: 0,
      characterSlot: 0,
    });

    const replacedEquipment = applyAndMirror(state, shadow, {
      type: 'playEquipment',
      handIndex: 0,
      targetIndex: 0,
    });
    expect(replacedEquipment).toHaveLength(2);
    expect(replacedEquipment[0]?.type === 'move' ? replacedEquipment[0].from : null).toEqual({
      type: 'equipment',
      player: 0,
      characterSlot: 0,
    });

    const firstField = applyAndMirror(state, shadow, { type: 'playField', handIndex: 0 });
    expect(firstField[0]?.type === 'move' ? firstField[0].to : null).toEqual({ type: 'field' });

    const replacedField = applyAndMirror(state, shadow, { type: 'playField', handIndex: 0 });
    expect(replacedField).toHaveLength(2);
    expect(replacedField[0]?.type === 'move' ? replacedField[0].from : null).toEqual({ type: 'field' });
  });

  it('effectが途中で失敗したら、そのeffect内で成功済みだったmoveもtraceから戻す', () => {
    const state = testBattle(characterWith('木'), ROLLBACK_SKILL);
    state.players[0].hand = [ROLLBACK_SKILL];
    state.players[0].deck = Array(6).fill(VANILLA_ATK);
    state.players[0].trash = [];
    state.players[0].ap = [];
    state.players[1].deck = Array(6).fill(VANILLA_ATK);
    Object.freeze(state.players[1].ap);
    const shadow = shadowOf(state);

    const mutations = applyAndMirror(state, shadow, { type: 'playSkill', handIndex: 0 });

    expect(mutations).toEqual([
      {
        type: 'move',
        printingId: ROLLBACK_SKILL,
        from: { type: 'array', player: 0, zone: 'hand', index: 0 },
        to: { type: 'array', player: 0, zone: 'trash', index: 0 },
      },
    ]);
    expect(state.players[0].deck).toHaveLength(6);
    expect(state.players[1].deck).toHaveLength(6);
    expect(state.log.some((line) => line.includes('効果でエラーが起きたためスキップ'))).toBe(true);
  });

  it('複数seedのAI戦を最後まで追跡しても、全zoneの個体shadowがengineと一致する', () => {
    const decks = sampleArchetypeDecks();
    for (const seed of [1, 7, 42, 2026]) {
      const left = decks[seed % decks.length].deck;
      const right = decks[(seed + 3) % decks.length].deck;
      const state = createBattle([left, right], seed);
      const shadow = shadowOf(state);
      const ais = [searchAi({ keepHand: 2 }), searchAi({ keepHand: 2 })] as const;
      let actions = 0;

      while (state.phase !== 'finished') {
        actions++;
        if (actions > 5000) throw new Error(`seed=${seed}: AI戦が終了しません`);
        const player = actingPlayer(state);
        applyAndMirror(state, shadow, ais[player].choose(state, player));
      }

      expect(actions, `seed=${seed}`).toBeGreaterThan(0);
      expect(state.endReason, `seed=${seed}`).not.toBeNull();
    }
  });
});
