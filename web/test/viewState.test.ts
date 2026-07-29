import {
  cardByPrintingId,
  createBattle,
  sampleArchetypeDecks,
} from '@bravers/engine';
import { describe, expect, it } from 'vitest';
import { applyEventToView } from '../src/battle/useBattle';
import type { NarrEvent } from '../src/battle/narrator';

function battleView() {
  const [first, second] = sampleArchetypeDecks();
  return createBattle([first.deck, second.deck], 7, {
    firstPlayer: 0,
    validate: true,
  });
}

describe('バトル演出用state', () => {
  it('デッキ発動は対象printingをdeckからだけ除き、無関係な手札を消さない', () => {
    const view = battleView();
    const castPrintingId = '1-A037-USR';
    const unrelatedHand = '1-A129-C';
    const deckRemainder = '1-A130-C';
    view.players[0].hand = [unrelatedHand];
    view.players[0].deck = [castPrintingId, deckRemainder];
    view.players[0].trash = [];
    const event: NarrEvent = {
      key: 1,
      kind: 'play',
      text: 'デッキから発動',
      card: cardByPrintingId(castPrintingId),
      side: 0,
      charIndex: 0,
      source: 'deck',
      duration: 1000,
    };

    applyEventToView(view, event);

    expect(view.players[0].hand).toEqual([unrelatedHand]);
    expect(view.players[0].deck).toEqual([deckRemainder]);
    // trashへの追加はカットイン後のタイマーが担当する。
    expect(view.players[0].trash).toEqual([]);
  });
});
