import {
  parseMatchViewerEventBatch,
  type MatchTerminalProjection,
  type MatchViewerEvent,
  type MatchViewerEventBatch,
  type MatchViewerSeat,
} from '@bravers/protocol';
import type { AppliedBattleStep } from '../battle/engineBattleAdapter';

type BattleEvent = AppliedBattleStep['events'][number];
type PlayerIndex = AppliedBattleStep['player'];

export class ViewerEventProjectionError extends Error {
  constructor() {
    super('MATCH_VIEWER_EVENT_INVALID');
    this.name = 'ViewerEventProjectionError';
  }
}

function playerForSeat(seat: MatchViewerSeat): PlayerIndex {
  return seat === 'player-1' ? 0 : 1;
}

function finishedResult(event: Extract<BattleEvent, { t: 'battleEnd' }>): MatchTerminalProjection {
  if (event.reason !== 'wipeout' && event.reason !== 'deckout' && event.reason !== 'turnLimit') {
    throw new ViewerEventProjectionError();
  }
  return { state: 'finished', winner: event.winner, reason: event.reason };
}

/**
 * raw BattleEventをbrowserへ出さず、viewerに公開可能な事実だけへ変換する。
 * opponentのhand charge/searchとfree-form text/labelはdropする。hidden-only stepでも
 * 空batchを残すため、raw event内容に依存せずstable step単位でcursorが進む。
 */
export function projectViewerEvent(
  event: BattleEvent,
  viewerSeat: MatchViewerSeat,
): MatchViewerEvent | null {
  const viewer = playerForSeat(viewerSeat);
  switch (event.t) {
    case 'battleStart':
      return { type: 'battleStarted', firstPlayer: event.first };
    case 'bonusCharge':
      return { type: 'bonusCharge', player: event.player, count: event.n };
    case 'turnStart':
      return { type: 'turnStarted', turn: event.turn, player: event.player };
    case 'battleEnd':
      return { type: 'matchEnded', result: finishedResult(event) };
    case 'deckout':
      return { type: 'deckOut', player: event.player };
    case 'draw':
      return { type: 'cardsDrawn', player: event.player, count: event.n };
    case 'chargeHand':
      return event.player === viewer
        ? { type: 'cardsCharged', player: event.player, source: 'hand', count: 1 }
        : null;
    case 'chargeDeck':
      return { type: 'cardsCharged', player: event.player, source: 'deck', count: event.n };
    case 'chargeTrash':
      return { type: 'cardsCharged', player: event.player, source: 'trash', count: event.n };
    case 'chargeAllHand':
      return { type: 'cardsCharged', player: event.player, source: 'allHand', count: event.n };
    case 'handTrash':
      return { type: 'cardsDiscarded', player: event.player, count: event.n };
    case 'mill':
      return { type: 'cardsMilled', player: event.player, count: event.n };
    case 'apTrash':
      return { type: 'apDiscarded', player: event.player, count: event.n };
    case 'searchToHand':
      return null;
    case 'trashToDeck':
      return { type: 'trashReturnedToDeck', player: event.player, count: event.n };
    case 'skillUsed':
      return {
        type: 'skillPlayed',
        player: event.player,
        characterSlot: event.charIndex,
        printingId: event.cardId,
      };
    case 'characterCardUsed':
      return { type: 'characterPlayed', player: event.player, printingId: event.cardId };
    case 'castFromDeck':
      return {
        type: 'cardCastFromDeck',
        player: event.player,
        characterSlot: event.charIndex,
        printingId: event.cardId,
      };
    case 'attackDeclared':
      return {
        type: 'attackDeclared',
        player: event.player,
        characterSlot: event.charIndex,
        printingId: event.cardId,
        value: event.value,
        noGuard: event.noGuard,
      };
    case 'guardPlayed':
      return {
        type: 'guardPlayed',
        player: event.player,
        characterSlot: event.charIndex,
        printingId: event.cardId,
        before: event.before,
        after: event.after,
      };
    case 'equip':
      return {
        type: 'equipmentPlayed',
        player: event.player,
        characterSlot: event.charIndex,
        printingId: event.cardId,
        ...(event.removedCardId ? { removedPrintingId: event.removedCardId } : {}),
      };
    case 'equipDestroyed':
      return {
        type: 'equipmentDestroyed',
        player: event.player,
        characterSlot: event.charIndex,
        printingId: event.cardId,
      };
    case 'fieldSet':
      return {
        type: 'fieldPlayed',
        player: event.player,
        printingId: event.cardId,
        ...(event.replacedCardId ? { replacedPrintingId: event.replacedCardId } : {}),
      };
    case 'powerUp':
      return {
        type: 'powerChanged',
        player: event.player,
        characterSlot: event.charIndex,
        amount: event.n,
        total: event.total,
      };
    case 'guardBoost':
      return {
        type: 'guardBoosted',
        player: event.player,
        amount: event.n,
        remaining: event.remain,
      };
    case 'damage':
      return {
        type: 'damageTaken',
        player: event.player,
        characterSlot: event.charIndex,
        amount: event.n,
        hpLeft: event.hpLeft,
        ...(event.sourceCardId ? { sourcePrintingId: event.sourceCardId } : {}),
      };
    case 'standbyImmune':
      return { type: 'standbyImmune', player: event.player, characterSlot: event.charIndex };
    case 'heal':
      return {
        type: 'healed',
        player: event.player,
        characterSlot: event.charIndex,
        amount: event.n,
      };
    case 'ko':
      return {
        type: 'characterKnockedOut',
        player: event.player,
        characterSlot: event.charIndex,
      };
    case 'revive':
      return {
        type: 'characterRevived',
        player: event.player,
        characterSlot: event.charIndex,
        hp: event.hp,
      };
    case 'actorChanged':
      return {
        type: 'actorChanged',
        player: event.player,
        characterSlot: event.charIndex,
        forced: event.forced,
      };
    case 'actorLocked':
      return { type: 'actorLocked', player: event.player, untilTurn: event.untilTurn };
    case 'actorUnlocked':
      return { type: 'actorUnlocked', player: event.player };
    case 'lockBlocked':
      return { type: 'actorLockBlocked', player: event.player };
    case 'attributeAdded':
    case 'abilityTriggered':
    case 'info':
      return null;
  }
}

/** raw event数に関係なくauthoritative step 1件をviewer cursor 1件へ固定する。 */
export function createMatchViewerEventBatch(
  step: AppliedBattleStep,
  viewerSeat: MatchViewerSeat,
): MatchViewerEventBatch {
  const events = step.events.flatMap((event) => {
    const projected = projectViewerEvent(event, viewerSeat);
    return projected ? [projected] : [];
  });
  const candidate: MatchViewerEventBatch = {
    sequence: step.sequence + 1,
    events,
  };
  const decoded = parseMatchViewerEventBatch(candidate);
  if (!decoded) throw new ViewerEventProjectionError();
  return decoded;
}
