import type { BattleEvent, PlayerIndex } from '@bravers/engine';
import {
  parseMatchViewerEventBatch,
  type MatchViewerSeat,
} from '@bravers/protocol';
import { describe, expect, it } from 'vitest';
import type { AppliedBattleStep } from '../src/battle/engineBattleAdapter';
import { createMatchViewerEventBatch } from '../src/match/viewerEventProjection';

const textEncoder = new TextEncoder();

function appliedStep(
  events: BattleEvent[],
  sequence = 40,
): AppliedBattleStep {
  return {
    sequence,
    player: 0,
    source: 'human',
    action: { type: 'endPlay' },
    stateHash: 'stable-state-hash',
    identityHash: 'stable-identity-hash',
    events,
  };
}

function hiddenPlayerFor(viewerSeat: MatchViewerSeat): PlayerIndex {
  return viewerSeat === 'player-1' ? 1 : 0;
}

function mixedEvents(
  hiddenPlayer: PlayerIndex,
  privateSuffix: string,
): BattleEvent[] {
  return [
    { t: 'battleStart', first: 0 },
    { t: 'turnStart', turn: 7, player: 0 },
    { t: 'draw', player: hiddenPlayer, n: 2 },
    {
      t: 'chargeHand',
      player: hiddenPlayer,
      cardId: `private-charge-${privateSuffix}`,
      ap: 3,
    },
    {
      t: 'searchToHand',
      player: hiddenPlayer,
      cardId: `private-search-${privateSuffix}`,
    },
    { t: 'info', text: `private-info-${privateSuffix}` },
    {
      t: 'abilityTriggered',
      label: `private-ability-${privateSuffix}`,
      player: hiddenPlayer,
      charIndex: 1,
    },
    { t: 'skillUsed', player: 0, charIndex: 1, cardId: 'public-skill' },
    {
      t: 'attackDeclared',
      player: 0,
      charIndex: 1,
      cardId: 'public-attack',
      value: 8,
      noGuard: false,
    },
    {
      t: 'damage',
      player: 1,
      charIndex: 0,
      n: 3,
      hpLeft: 9,
      sourceCardId: 'public-attack',
    },
    { t: 'battleEnd', winner: 0, reason: 'wipeout' },
  ];
}

describe('OLG-126 viewer event projection', () => {
  for (const viewerSeat of ['player-1', 'player-2'] as const) {
    it(`${viewerSeat}へ相手hidden情報の変更をbyte単位で漏らさず公開eventを残す`, () => {
      const hiddenPlayer = hiddenPlayerFor(viewerSeat);
      const before = createMatchViewerEventBatch(
        appliedStep(mixedEvents(hiddenPlayer, 'before')),
        viewerSeat,
      );
      const after = createMatchViewerEventBatch(
        appliedStep(mixedEvents(hiddenPlayer, 'after')),
        viewerSeat,
      );
      const beforeWire = JSON.stringify(before);
      const afterWire = JSON.stringify(after);

      expect(before.sequence).toBe(41);
      expect(after.sequence).toBe(before.sequence);
      expect(textEncoder.encode(afterWire)).toEqual(textEncoder.encode(beforeWire));
      expect(afterWire).not.toContain('private-');
      expect(before.events).toEqual([
        { type: 'battleStarted', firstPlayer: 0 },
        { type: 'turnStarted', turn: 7, player: 0 },
        { type: 'cardsDrawn', player: hiddenPlayer, count: 2 },
        {
          type: 'skillPlayed',
          player: 0,
          characterSlot: 1,
          printingId: 'public-skill',
        },
        {
          type: 'attackDeclared',
          player: 0,
          characterSlot: 1,
          printingId: 'public-attack',
          value: 8,
          noGuard: false,
        },
        {
          type: 'damageTaken',
          player: 1,
          characterSlot: 0,
          amount: 3,
          hpLeft: 9,
          sourcePrintingId: 'public-attack',
        },
        {
          type: 'matchEnded',
          result: { state: 'finished', winner: 0, reason: 'wipeout' },
        },
      ]);
      expect(parseMatchViewerEventBatch(JSON.parse(beforeWire))).toEqual(before);
    });

    it(`${viewerSeat}のhidden-only stepでも空batchのcursorを進めexact parserを通す`, () => {
      const hiddenPlayer = hiddenPlayerFor(viewerSeat);
      const batch = createMatchViewerEventBatch(
        appliedStep(
          [
            {
              t: 'chargeHand',
              player: hiddenPlayer,
              cardId: 'private-charge-only',
              ap: 1,
            },
            {
              t: 'searchToHand',
              player: hiddenPlayer,
              cardId: 'private-search-only',
            },
            { t: 'info', text: 'private-info-only' },
            {
              t: 'abilityTriggered',
              label: 'private-ability-only',
              player: hiddenPlayer,
            },
          ],
          88,
        ),
        viewerSeat,
      );
      const wire = JSON.stringify(batch);

      expect(batch).toEqual({ sequence: 89, events: [] });
      expect(wire).not.toContain('private-');
      expect(parseMatchViewerEventBatch(JSON.parse(wire))).toEqual(batch);
    });
  }
});
