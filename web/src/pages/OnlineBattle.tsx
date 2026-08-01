import type {
  MatchAction,
  MatchPlayerBoardProjection,
  MatchPlayerProjection,
  MatchPublicCardProjection,
  MatchViewerEvent,
} from '@bravers/protocol';
import { cardByPrintingId, type Card } from '@bravers/engine';
import { useEffect, useState } from 'react';
import { CardFrame } from '../CardFrame';
import {
  actionLabel,
  attackLabels,
  effectLabels,
  eventLabel,
  fieldOwnerLabel,
  hiddenHandLabel,
  joinAttributeLabels,
  onlineBattleMessages,
  otherCardsLabel,
  phaseLabel,
  terminalMessage,
  unknownCardName,
} from '../online/onlineBattleMessages';
import type { OnlineLocale } from '../online/recoveryMessages';

export interface OnlineBattleProps {
  projection: MatchPlayerProjection;
  connectionLabel?: string;
  commandPending: boolean;
  commandError?: string | null;
  recentEvents?: readonly MatchViewerEvent[];
  locale?: OnlineLocale;
  onAction: (action: MatchAction) => void;
  onExit: () => void;
}

function knownCard(printingId: string): Card | null {
  try {
    return cardByPrintingId(printingId);
  } catch {
    return null;
  }
}

function cardName(printingId: string, locale: OnlineLocale): string {
  return knownCard(printingId)?.name ?? unknownCardName(locale, printingId);
}

function CardVisual({
  card,
  locale,
  size = 'normal',
}: {
  card: MatchPublicCardProjection;
  locale: OnlineLocale;
  size?: 'small' | 'normal';
}) {
  const catalogCard = knownCard(card.printingId);
  const width = size === 'small' ? 46 : 72;

  return (
    <div className={`ob-card ob-card--${size}`} aria-label={cardName(card.printingId, locale)}>
      {catalogCard ? (
        <CardFrame card={catalogCard} width={width} upright />
      ) : (
        <div className="ob-card-unknown" title={card.printingId}>
          <span aria-hidden="true">?</span>
          <small>{onlineBattleMessages(locale).unknownCardShort}</small>
        </div>
      )}
    </div>
  );
}

function HiddenCard({ index, locale }: { index: number; locale: OnlineLocale }) {
  return (
    <div className="ob-card-back" aria-label={hiddenHandLabel(locale, index)}>
      <span aria-hidden="true">BD</span>
    </div>
  );
}

function PlayerLane({
  board,
  isViewer,
  isActive,
  locale,
}: {
  board: MatchPlayerBoardProjection;
  isViewer: boolean;
  isActive: boolean;
  locale: OnlineLocale;
}) {
  const m = onlineBattleMessages(locale);
  const visibleHand = isViewer && board.hand.visibility === 'private' ? board.hand.cards : null;
  const hiddenCount = visibleHand
    ? 0
    : board.hand.visibility === 'hidden'
      ? board.hand.count
      : board.hand.cards.length;
  const latestTrash = board.trash.at(-1);

  return (
    <section
      className={`ob-player ${isViewer ? 'ob-player--viewer' : 'ob-player--opponent'}${isActive ? ' is-active' : ''}`}
      aria-label={isViewer ? m.yourBoard : m.opponentBoard}
    >
      <header className="ob-player-summary">
        <div>
          <span className="ob-player-name">{isViewer ? m.you : m.opponent}</span>
          {isActive && <span className="ob-turn-badge">{m.acting}</span>}
        </div>
        <dl className="ob-resource-list">
          <div><dt>AP</dt><dd>{board.apCount}</dd></div>
          <div><dt>{m.deck}</dt><dd>{board.deckCount}</dd></div>
          <div><dt>{m.hand}</dt><dd>{visibleHand?.length ?? hiddenCount}</dd></div>
          <div><dt>{m.trash}</dt><dd>{board.trash.length}</dd></div>
        </dl>
      </header>

      <div className="ob-character-row" aria-label={m.characters}>
        {board.characters.map((character, slot) => (
          <article
            className={`ob-character${slot === board.actorSlot ? ' is-actor' : ''}`}
            key={character.card.battleCardId}
          >
            <span className="ob-slot-label">
              {slot === board.actorSlot ? 'ACTOR' : `SLOT ${slot + 1}`}
            </span>
            <CardVisual card={character.card} locale={locale} />
            <div className="ob-character-stats">
              <span>{m.damage} {character.damage}</span>
              {character.addedAttributes.length > 0 && (
                <span title={joinAttributeLabels(locale, character.addedAttributes)}>
                  {m.addedAttributes} {joinAttributeLabels(locale, character.addedAttributes)}
                </span>
              )}
            </div>
            {character.equipment && (
              <div className="ob-equipment">
                <span>{m.equipment}</span>
                <CardVisual card={character.equipment} locale={locale} size="small" />
              </div>
            )}
          </article>
        ))}
      </div>

      <div className="ob-zone-row">
        <div className="ob-hand" aria-label={isViewer ? m.yourHand : m.opponentHand}>
          {visibleHand
            ? visibleHand.map((card) => <CardVisual card={card} locale={locale} key={card.battleCardId} />)
            : Array.from({ length: Math.min(hiddenCount, 8) }, (_, index) => (
                <HiddenCard index={index} locale={locale} key={index} />
              ))}
          {!visibleHand && hiddenCount > 8 && <span className="ob-more-count">{otherCardsLabel(locale, hiddenCount - 8)}</span>}
          {(visibleHand?.length ?? hiddenCount) === 0 && <span className="ob-empty-zone">{m.noCardsInHand}</span>}
        </div>
        <div className="ob-trash-top" aria-label={m.topOfTrash}>
          <span>TRASH</span>
          {latestTrash ? <CardVisual card={latestTrash} locale={locale} size="small" /> : <span className="ob-empty-zone">{m.empty}</span>}
        </div>
      </div>
      {(board.skillsUsedThisTurn > 0 || board.nextSkillCostDelta !== 0 || board.nextDrawDelta !== 0 ||
        board.actorLockUntilTurn > 0 || board.incomingDamageReduction || board.chargedThisTurn > 0) && (
        <ul className="ob-effect-list" aria-label={isViewer ? m.yourEffects : m.opponentEffects}>
          {board.skillsUsedThisTurn > 0 && <li>{m.skillUses} {board.skillsUsedThisTurn}</li>}
          {board.chargedThisTurn > 0 && <li>{m.chargesThisTurn} {board.chargedThisTurn}</li>}
          {board.nextSkillCostDelta !== 0 && <li>{m.nextCost} {board.nextSkillCostDelta > 0 ? '+' : ''}{board.nextSkillCostDelta}</li>}
          {board.nextDrawDelta !== 0 && <li>{m.nextDraw} {board.nextDrawDelta > 0 ? '+' : ''}{board.nextDrawDelta}</li>}
          {board.actorLockUntilTurn > 0 && <li>{effectLabels(locale, board).actorLock}</li>}
          {board.incomingDamageReduction && (
            <li>{effectLabels(locale, board).damageReduction}</li>
          )}
        </ul>
      )}
    </section>
  );
}

function visibleCardNames(projection: MatchPlayerProjection, locale: OnlineLocale): Map<string, string> {
  const names = new Map<string, string>();
  const add = (card: MatchPublicCardProjection | null | undefined) => {
    if (card) names.set(card.battleCardId, cardName(card.printingId, locale));
  };
  const viewer = projection.viewerPlayer;
  projection.players.forEach((board, index) => {
    board.characters.forEach((character) => {
      add(character.card);
      add(character.equipment);
    });
    board.trash.forEach(add);
    // PlayerLaneのisViewerと同じ位置的フラグでガードし、自分の手札以外はprivate配列が来ても参照しない。
    if (index === viewer && board.hand.visibility === 'private') {
      board.hand.cards.forEach(add);
    }
  });
  add(projection.field);
  return names;
}

/** フェーズを先へ進める操作は誤タップで取り消せないため、2回目の押下で確定する。 */
export function actionNeedsConfirmation(action: MatchAction): boolean {
  return action.type === 'endPlay' || action.type === 'pass' || action.type === 'endTurn';
}

export function OnlineBattle({
  projection,
  connectionLabel,
  commandPending,
  commandError,
  recentEvents = [],
  locale = 'ja-JP',
  onAction,
  onExit,
}: OnlineBattleProps) {
  const m = onlineBattleMessages(locale);
  const resolvedConnectionLabel = connectionLabel ?? m.connectionOnline;
  const viewer = projection.viewerPlayer;
  const opponent = viewer === 0 ? 1 : 0;
  const terminal = projection.terminal ? terminalMessage(locale, projection.terminal, viewer) : null;
  const actionCardNames = visibleCardNames(projection, locale);
  const resolveCardName = (printingId: string) => cardName(printingId, locale);
  const [confirmingAction, setConfirmingAction] = useState<string | null>(null);

  useEffect(() => {
    setConfirmingAction(null);
  }, [projection.revision, commandPending]);

  return (
    <main className="online-battle">
      <header className="ob-topbar">
        <button className="ob-exit" type="button" onClick={onExit} aria-label={m.backLabel}>
          {m.back}
        </button>
        <div className="ob-match-heading">
          <strong>ONLINE BATTLE</strong>
          <span>TURN {projection.turn} · {phaseLabel(locale, projection.phase)}</span>
        </div>
        <div className="ob-connection" role="status" aria-live="polite">
          <span className="ob-connection-dot" aria-hidden="true" />
          {resolvedConnectionLabel}
        </div>
      </header>

      <div className="ob-layout">
        <div className="ob-board">
          <PlayerLane
            board={projection.players[opponent]}
            isViewer={false}
            isActive={projection.activePlayer === opponent}
            locale={locale}
          />

          <section className="ob-center" aria-label={m.sharedArea}>
            <div className="ob-field-zone">
              <span className="ob-zone-title">FIELD</span>
              {projection.field ? (
                <div className="ob-field-card">
                  <CardVisual card={projection.field} locale={locale} size="small" />
                  <span>
                    {resolveCardName(projection.field.printingId)}
                    <small>{fieldOwnerLabel(locale, projection.field.owner, viewer)}</small>
                  </span>
                </div>
              ) : (
                <span className="ob-empty-zone">{m.noField}</span>
              )}
            </div>
            {projection.pendingAttack && (
              <div className="ob-attack" role="status">
                <strong>{attackLabels(locale, {
                  value: projection.pendingAttack.value,
                  attackerSlot: projection.pendingAttack.attackerSlot,
                  chosenSlot: projection.pendingAttack.chosenSlot,
                  noGuard: projection.pendingAttack.noGuard,
                  guardValue: projection.pendingAttack.guard?.value,
                }).title}</strong>
                <span>{resolveCardName(projection.pendingAttack.skillPrintingId)}</span>
                <small>
                  {attackLabels(locale, {
                    value: projection.pendingAttack.value,
                    attackerSlot: projection.pendingAttack.attackerSlot,
                    chosenSlot: projection.pendingAttack.chosenSlot,
                    noGuard: projection.pendingAttack.noGuard,
                    guardValue: projection.pendingAttack.guard?.value,
                  }).detail}
                </small>
              </div>
            )}
          </section>

          <PlayerLane
            board={projection.players[viewer]}
            isViewer
            isActive={projection.activePlayer === viewer}
            locale={locale}
          />

          {terminal && (
            <section className="ob-result" role="status" aria-live="polite">
              <span>RESULT</span>
              <strong>{terminal.title}</strong>
              <p>{terminal.detail}</p>
              <button type="button" onClick={onExit}>{m.backToDuelSpace}</button>
            </section>
          )}
        </div>

        <aside className="ob-rail" aria-label={m.battleInfoAndActions}>
          <section className="ob-rail-panel ob-status-panel">
            <h2>{m.matchStatus}</h2>
            <dl>
              <div><dt>{m.connection}</dt><dd>{resolvedConnectionLabel}</dd></div>
              <div><dt>{m.turn}</dt><dd>{projection.turn}</dd></div>
              <div><dt>{m.phase}</dt><dd>{phaseLabel(locale, projection.phase)}</dd></div>
              <div><dt>{m.activePlayer}</dt><dd>{projection.activePlayer === viewer ? m.you : m.opponent}</dd></div>
            </dl>
          </section>

          <section className="ob-rail-panel ob-action-panel" aria-labelledby="ob-action-title">
            <h2 id="ob-action-title">{m.actions}</h2>
            {commandError && <p className="ob-command-error" role="alert">{commandError}</p>}
            {commandPending && <p className="ob-command-pending" role="status">{m.sendingAction}</p>}
            {!projection.terminal && projection.legalActions.length > 0 ? (
              <div className="ob-actions">
                {projection.legalActions.map((action, index) => {
                  const label = actionLabel(locale, action, actionCardNames);
                  const actionKey = JSON.stringify(action);
                  const needsConfirmation = actionNeedsConfirmation(action);
                  const confirming = needsConfirmation && confirmingAction === actionKey;
                  return (
                    <button
                      className={`ob-action${needsConfirmation ? ' is-phase' : ''}${confirming ? ' is-confirming' : ''}`}
                      type="button"
                      key={`${action.type}-${index}`}
                      disabled={commandPending}
                      aria-pressed={needsConfirmation ? confirming : undefined}
                      onClick={() => {
                        if (needsConfirmation && !confirming) {
                          setConfirmingAction(actionKey);
                          return;
                        }
                        setConfirmingAction(null);
                        onAction(action);
                      }}
                    >
                      <strong>{confirming ? m.confirmAgain : label.title}</strong>
                      <span>{confirming ? `${label.title}${m.cannotUndo}` : label.detail}</span>
                    </button>
                  );
                })}
              </div>
            ) : !projection.terminal ? (
              <p className="ob-waiting" role="status">{m.waitingForOpponent}</p>
            ) : null}
          </section>

          <section className="ob-rail-panel ob-log-panel" aria-labelledby="ob-log-title">
            <h2 id="ob-log-title">{m.battleLog}</h2>
            {recentEvents.length > 0 ? (
              <>
                <p className="ob-sr-only" role="status" aria-live="polite" aria-atomic="true">
                  {eventLabel(locale, recentEvents.at(-1)!, viewer, resolveCardName)}
                </p>
                <ol className="ob-event-list">
                {recentEvents.map((event, index) => (
                  <li key={`${event.type}-${index}`}>{eventLabel(locale, event, viewer, resolveCardName)}</li>
                ))}
                </ol>
              </>
            ) : (
              <p className="ob-empty-log">{m.noLog}</p>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
