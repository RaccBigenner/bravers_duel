import {
  MATCH_PLAYER_PROJECTION_VERSION,
  MATCH_VIEWER_EVENT_VERSION,
  parseBattleCardId,
  parseMatchId,
  parseMatchRevision,
  type MatchPlayerProjection,
  type MatchPublicCardProjection,
  type MatchViewerEvent,
} from '@bravers/protocol';
import { Home } from '../pages/Home';
import { OnlineBattle } from '../pages/OnlineBattle';
import { RecoveryBanner } from './RecoveryBanner';

function publicCard(id: number, printingId: string): MatchPublicCardProjection {
  const battleCardId = parseBattleCardId(`bc_${id.toString(16).padStart(32, '0')}`);
  if (!battleCardId) throw new Error('Invalid recovery preview card');
  return { battleCardId, printingId };
}

function previewProjection(): MatchPlayerProjection {
  const matchId = parseMatchId('preview-online-match');
  const revision = parseMatchRevision(12);
  if (!matchId || revision === null) throw new Error('Invalid recovery preview match');
  const ownHand = [
    publicCard(21, '1-A037-USR'),
    publicCard(22, '1-A041-SR'),
    publicCard(23, '1-A025-SR'),
    publicCard(24, '1-A029-C'),
  ];
  return {
    type: 'matchPlayerProjection',
    projectionVersion: MATCH_PLAYER_PROJECTION_VERSION,
    matchId,
    viewerSeat: 'player-1',
    viewerPlayer: 0,
    revision,
    viewerEventVersion: MATCH_VIEWER_EVENT_VERSION,
    eventSequence: 18,
    contentVersion: 'preview-content',
    formatVersionId: 'standard@1',
    turn: 4,
    activePlayer: 0,
    phase: 'play',
    firstPlayer: 0,
    pendingAttack: null,
    field: { ...publicCard(31, '1-A033-SR'), owner: 0 },
    players: [
      {
        player: 0,
        deckCount: 29,
        hand: { visibility: 'private', cards: ownHand },
        trash: [publicCard(32, '1-A030-C')],
        apCount: 3,
        characters: [
          { card: publicCard(1, '1-A003-USR'), damage: 2, addedAttributes: [], equipment: publicCard(11, '1-A026-SR') },
          { card: publicCard(2, '1-A010-SR'), damage: 0, addedAttributes: ['wind'], equipment: null },
          { card: publicCard(3, '1-A019-R'), damage: 1, addedAttributes: [], equipment: null },
        ],
        actorSlot: 0,
        skillsUsedThisTurn: 1,
        nextSkillCostDelta: -1,
        nextDrawDelta: 0,
        actorLockUntilTurn: 0,
        incomingDamageReduction: null,
        chargedThisTurn: 1,
      },
      {
        player: 1,
        deckCount: 31,
        hand: { visibility: 'hidden', count: 5 },
        trash: [publicCard(33, '1-A031-C')],
        apCount: 2,
        characters: [
          { card: publicCard(4, '1-A004-USR'), damage: 3, addedAttributes: [], equipment: null },
          { card: publicCard(5, '1-A008-SSR'), damage: 1, addedAttributes: [], equipment: publicCard(12, '1-A027-R') },
          { card: publicCard(6, '1-A015-SR'), damage: 0, addedAttributes: [], equipment: null },
        ],
        actorSlot: 1,
        skillsUsedThisTurn: 0,
        nextSkillCostDelta: 0,
        nextDrawDelta: 0,
        actorLockUntilTurn: 5,
        incomingDamageReduction: { value: 1, untilTurn: 4 },
        chargedThisTurn: 0,
      },
    ],
    winner: null,
    endReason: null,
    terminal: null,
    legalActions: [
      { type: 'playSkill', battleCardId: ownHand[0]!.battleCardId, usingCharacterSlot: 0, targetSlot: 1 },
      { type: 'playEquipment', battleCardId: ownHand[2]!.battleCardId, targetCharacterSlot: 1 },
      { type: 'charge', battleCardId: ownHand[3]!.battleCardId },
      { type: 'endPlay' },
    ],
  };
}

const previewEvents: MatchViewerEvent[] = [
  { type: 'turnStarted', turn: 4, player: 0 },
  { type: 'cardsDrawn', player: 0, count: 1 },
  { type: 'cardsCharged', player: 0, source: 'hand', count: 1 },
  { type: 'fieldPlayed', player: 0, printingId: '1-A033-SR' },
];

export function RecoveryPreview({ mode }: { mode: 'offer' | 'playing' }) {
  if (mode === 'playing') {
    return (
      <OnlineBattle
        projection={previewProjection()}
        locale="ja-JP"
        connectionLabel="同期済み"
        commandPending={false}
        recentEvents={previewEvents}
        onAction={() => undefined}
        onExit={() => undefined}
      />
    );
  }
  const matchId = parseMatchId('preview-online-match');
  if (!matchId) throw new Error('Invalid recovery preview match');
  return (
    <Home
      onBattle={() => undefined}
      onGallery={() => undefined}
      recovery={(
        <RecoveryBanner
          snapshot={{
            phase: 'offer',
            match: { kind: 'npc', matchId, seat: 'player-1', state: 'active' },
          }}
          locale="ja-JP"
          onResume={() => undefined}
          onRetry={() => undefined}
          onOpen={() => undefined}
          onDismiss={() => undefined}
        />
      )}
    />
  );
}
