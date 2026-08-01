import {
  MATCH_PLAYER_PROJECTION_VERSION,
  parseBattleCardId,
  parseMatchCommandId,
  parseMatchId,
  parseMatchRevision,
  type MatchCommandClientFrame,
  type MatchPlayerProjection,
  type MatchServerFrame,
} from '@bravers/protocol';
import { describe, expect, it } from 'vitest';
import {
  MAX_MATCH_CLIENT_FRAME_BYTES,
  MAX_MATCH_SERVER_FRAME_BYTES,
  MatchWireFrameError,
  parseMatchCommandWebSocketFrame,
  serializeMatchServerFrame,
} from '../src/match/matchWire';

function commandFrame(action: unknown = { type: 'endPlay' }): MatchCommandClientFrame {
  const matchId = parseMatchId('npc-wire-test');
  const commandId = parseMatchCommandId('cmd_00112233445566778899aabbccddeeff');
  const expectedRevision = parseMatchRevision(0);
  if (!matchId || !commandId || expectedRevision === null) throw new Error('Invalid fixture');
  return {
    type: 'matchCommand',
    command: { matchId, commandId, expectedRevision, action },
  };
}

function projection(): MatchPlayerProjection {
  const matchId = parseMatchId('npc-wire-test');
  const revision = parseMatchRevision(0);
  if (!matchId || revision === null) throw new Error('Invalid fixture');
  const player = (index: 0 | 1) => ({
    player: index,
    deckCount: 40,
    hand: index === 0
      ? { visibility: 'private' as const, cards: [] }
      : { visibility: 'hidden' as const, count: 0 },
    trash: [],
    apCount: 0,
    characters: [],
    actorSlot: 0,
    skillsUsedThisTurn: 0,
    nextSkillCostDelta: 0,
    nextDrawDelta: 0,
    actorLockUntilTurn: 0,
    incomingDamageReduction: null,
    chargedThisTurn: 0,
  });
  return {
    type: 'matchPlayerProjection',
    projectionVersion: MATCH_PLAYER_PROJECTION_VERSION,
    matchId,
    viewerSeat: 'player-1',
    viewerPlayer: 0,
    revision,
    eventSequence: 0,
    contentVersion: 'content-test',
    formatVersionId: 'standard@1',
    turn: 0,
    activePlayer: 0,
    phase: 'play',
    firstPlayer: 0,
    pendingAttack: null,
    field: null,
    players: [player(0), player(1)],
    winner: null,
    endReason: null,
    terminal: null,
    legalActions: [],
  };
}

function expectWireError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error('Expected MatchWireFrameError');
  } catch (error) {
    expect(error).toBeInstanceOf(MatchWireFrameError);
    expect((error as MatchWireFrameError).code).toBe(code);
  }
}

function utf8StringOfBytes(byteLength: number, maxCharacters: number): string {
  if (!Number.isInteger(byteLength) || byteLength < 1 || byteLength > maxCharacters * 3) {
    throw new Error('Invalid UTF-8 filler size');
  }
  const triples = Math.floor(byteLength / 3);
  const remainder = byteLength % 3;
  const value = `${'あ'.repeat(triples)}${remainder === 1 ? 'x' : remainder === 2 ? 'é' : ''}`;
  if (value.length > maxCharacters) throw new Error('UTF-8 filler exceeds character limit');
  return value;
}

function serverFrameAtEncodedBytes(targetBytes: number): MatchServerFrame {
  const value = projection();
  const battleCardId = parseBattleCardId('bc_00112233445566778899aabbccddeeff');
  if (!battleCardId) throw new Error('Invalid card fixture');
  const stringSlots: Array<(next: string) => void> = [];
  const card = () => {
    const result = { battleCardId, printingId: 'x' };
    stringSlots.push((next) => {
      result.printingId = next;
    });
    return result;
  };
  const character = () => ({
    card: card(),
    damage: 0,
    addedAttributes: [],
    equipment: card(),
  });
  value.players[0].hand = {
    visibility: 'private',
    cards: Array.from({ length: 64 }, card),
  };
  value.players[0].trash = Array.from({ length: 128 }, card);
  value.players[1].trash = Array.from({ length: 128 }, card);
  value.players[0].characters = Array.from({ length: 4 }, character);
  value.players[1].characters = Array.from({ length: 4 }, character);
  value.field = Object.assign(card(), { owner: 0 as const });
  const frame = { type: 'matchProjection', projection: value } satisfies MatchServerFrame;
  const encoder = new TextEncoder();
  let encodedBytes = encoder.encode(JSON.stringify(frame)).byteLength;
  let remaining = targetBytes - encodedBytes;
  if (remaining < 0) throw new Error('Base server frame exceeds requested size');
  for (const setSlot of stringSlots) {
    if (remaining === 0) break;
    const addedBytes = Math.min(remaining, 128 * 3 - 1);
    setSlot(utf8StringOfBytes(1 + addedBytes, 128));
    remaining -= addedBytes;
  }
  if (remaining !== 0) throw new Error('Insufficient valid projection padding capacity');
  encodedBytes = encoder.encode(JSON.stringify(frame)).byteLength;
  if (encodedBytes !== targetBytes) throw new Error('Failed to construct exact-size frame');
  return frame;
}

describe('OLG-124 match WebSocket wire', () => {
  it('text/ArrayBufferをUTF-8 byte gate後にcandidateまでexact decodeする', () => {
    const frame = commandFrame();
    const encoded = JSON.stringify(frame);
    expect(parseMatchCommandWebSocketFrame(encoded)).toEqual(frame);
    const binary = new TextEncoder().encode(encoded);
    expect(parseMatchCommandWebSocketFrame(binary.buffer)).toEqual(frame);
    expectWireError(
      () => parseMatchCommandWebSocketFrame(JSON.stringify({ ...frame, extra: true })),
      'MATCH_FRAME_INVALID',
    );
    expectWireError(
      () => parseMatchCommandWebSocketFrame(new Uint8Array([0xc3, 0x28]).buffer),
      'MATCH_FRAME_INVALID',
    );
  });

  it('JSON.parse前にASCII境界とUTF-8 multi-byte超過を拒否する', () => {
    const encoded = JSON.stringify(commandFrame());
    const atLimit = `${encoded}${' '.repeat(MAX_MATCH_CLIENT_FRAME_BYTES - encoded.length)}`;
    expect(new TextEncoder().encode(atLimit)).toHaveLength(MAX_MATCH_CLIENT_FRAME_BYTES);
    expect(parseMatchCommandWebSocketFrame(atLimit)).toEqual(commandFrame());
    expect(parseMatchCommandWebSocketFrame(new TextEncoder().encode(atLimit).buffer)).toEqual(
      commandFrame(),
    );
    expectWireError(
      () => parseMatchCommandWebSocketFrame(`${atLimit} `),
      'MATCH_FRAME_TOO_LARGE',
    );
    expectWireError(
      () => parseMatchCommandWebSocketFrame(new TextEncoder().encode(`${atLimit} `).buffer),
      'MATCH_FRAME_TOO_LARGE',
    );
    expectWireError(
      () => parseMatchCommandWebSocketFrame(`{${'x'.repeat(MAX_MATCH_CLIENT_FRAME_BYTES)}`),
      'MATCH_FRAME_TOO_LARGE',
    );

    const multibyte = JSON.stringify(commandFrame({
      type: 'unknown',
      padding: 'あ'.repeat(Math.floor(MAX_MATCH_CLIENT_FRAME_BYTES / 2)),
    }));
    expect(multibyte.length).toBeLessThan(MAX_MATCH_CLIENT_FRAME_BYTES);
    expect(new TextEncoder().encode(multibyte).byteLength).toBeGreaterThan(MAX_MATCH_CLIENT_FRAME_BYTES);
    expectWireError(
      () => parseMatchCommandWebSocketFrame(multibyte),
      'MATCH_FRAME_TOO_LARGE',
    );
  });

  it('server frameもexact検証してからserializeする', () => {
    const frame = { type: 'matchProjection', projection: projection() } satisfies MatchServerFrame;
    expect(JSON.parse(serializeMatchServerFrame(frame))).toEqual(frame);
    expectWireError(
      () => serializeMatchServerFrame({ ...frame, projection: { ...frame.projection, seed: 1 } } as never),
      'MATCH_FRAME_OUTPUT_INVALID',
    );
  });

  it('server frameは128 KiBちょうどを許可し1 byte超過を拒否する', () => {
    const atLimit = serializeMatchServerFrame(
      serverFrameAtEncodedBytes(MAX_MATCH_SERVER_FRAME_BYTES),
    );
    expect(new TextEncoder().encode(atLimit)).toHaveLength(MAX_MATCH_SERVER_FRAME_BYTES);
    expectWireError(
      () => serializeMatchServerFrame(
        serverFrameAtEncodedBytes(MAX_MATCH_SERVER_FRAME_BYTES + 1),
      ),
      'MATCH_FRAME_OUTPUT_TOO_LARGE',
    );
  });
});
