import {
  MATCH_AUTH_OK,
  MATCH_PLAYER_PROJECTION_VERSION,
  MATCH_VIEWER_EVENT_VERSION,
  parseMatchCommandId,
  parseMatchId,
  parseMatchRevision,
  parseMatchSeatAuthClientFrame,
  parseMatchSeatToken,
  type ActiveMatchDescriptor,
  type MatchCommandResult,
  type MatchId,
  type MatchPlayerProjection,
  type MatchSeatTokenResponse,
  type MatchServerFrame,
  type MatchTerminalProjection,
} from '@bravers/protocol';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  BrowserMatchTransport,
  MatchTransportError,
  ONLINE_CLIENT_HEADER,
  ONLINE_CLIENT_HEADER_VALUE,
  type MatchSocketLike,
} from '../src/online/matchTransport';
import {
  MatchRecoveryController,
  type MatchRecoveryDependencies,
  type RecoveryScheduler,
} from '../src/online/recoveryMachine';
import { RecoveryBanner } from '../src/online/RecoveryBanner';
import { MatchRecoveryStorage, type RecoveryStorageLike } from '../src/online/recoveryStorage';
import { OnlineBattle, actionNeedsConfirmation } from '../src/pages/OnlineBattle';

const onlineCss = readFileSync(new URL('../src/online.css', import.meta.url), 'utf8');

function fixtureMatch(state: ActiveMatchDescriptor['state'] = 'active'): ActiveMatchDescriptor {
  const matchId = parseMatchId('npc_recovery_fixture');
  if (!matchId) throw new Error('invalid match fixture');
  return { kind: 'npc', matchId, seat: 'player-1', state };
}

function fixtureProjection(input: {
  matchId?: MatchId;
  revision?: number;
  eventSequence?: number;
  terminal?: MatchTerminalProjection | null;
} = {}): MatchPlayerProjection {
  const matchId = input.matchId ?? fixtureMatch().matchId;
  const revision = parseMatchRevision(input.revision ?? 1);
  if (revision === null) throw new Error('invalid revision fixture');
  const player = (index: 0 | 1) => ({
    player: index,
    deckCount: 40,
    hand: index === 0
      ? { visibility: 'private' as const, cards: [] }
      : { visibility: 'hidden' as const, count: 3 },
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
  const terminal = input.terminal ?? null;
  return {
    type: 'matchPlayerProjection',
    projectionVersion: MATCH_PLAYER_PROJECTION_VERSION,
    matchId,
    viewerSeat: 'player-1',
    viewerPlayer: 0,
    revision,
    viewerEventVersion: MATCH_VIEWER_EVENT_VERSION,
    eventSequence: input.eventSequence ?? 0,
    contentVersion: 'content-test',
    formatVersionId: 'standard@1',
    turn: 1,
    activePlayer: 0,
    phase: terminal ? 'finished' : 'play',
    firstPlayer: 0,
    pendingAttack: null,
    field: null,
    players: [player(0), player(1)],
    winner: terminal?.state === 'finished' ? terminal.winner : null,
    endReason: terminal?.state === 'finished' ? terminal.reason : null,
    terminal,
    legalActions: terminal ? [] : [{ type: 'endPlay' }],
  };
}

function projectionFrame(
  projection = fixtureProjection(),
  afterEventSequence?: number,
): MatchServerFrame {
  return {
    type: 'matchProjection',
    projection,
    sync: afterEventSequence === undefined
      ? {
          type: 'matchViewerSync',
          mode: 'snapshot',
          reason: 'initial',
          eventSequence: projection.eventSequence,
        }
      : {
          type: 'matchViewerSync',
          mode: 'delta',
          afterEventSequence,
          batches: [],
        },
  };
}

class MemoryStorage implements RecoveryStorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

class NoopScheduler implements RecoveryScheduler {
  readonly pending: Array<{ callback: () => void; delayMs: number; active: boolean }> = [];
  schedule(callback: () => void, delayMs: number): () => void {
    const item = { callback, delayMs, active: true };
    this.pending.push(item);
    return () => { item.active = false; };
  }
  runNext(): boolean {
    const item = this.pending.find((candidate) => candidate.active);
    if (!item) return false;
    item.active = false;
    item.callback();
    return true;
  }
}

class FakeSocket implements MatchSocketLike {
  binaryType: BinaryType = 'blob';
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly sent: string[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  send(data: string): void { this.sent.push(data); }
  close(code?: number, reason?: string): void { this.closes.push({ code, reason }); }
  open(): void { this.onopen?.({} as Event); }
  message(data: unknown): void { this.onmessage?.({ data } as MessageEvent<unknown>); }
  serverClose(code: number, reason: string): void {
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

function seatTokenResponse(): MatchSeatTokenResponse {
  const seatToken = parseMatchSeatToken('A'.repeat(43));
  if (!seatToken) throw new Error('invalid seat token fixture');
  return { seatToken, expiresAt: '2099-01-01T00:00:00.000Z' };
}

function controllerFixture(options: {
  active?: ActiveMatchDescriptor | null;
  result?: MatchTerminalProjection | null;
  storage?: MemoryStorage;
} = {}) {
  const match = options.active === undefined ? fixtureMatch() : options.active;
  const sockets: FakeSocket[] = [];
  const calls = { active: 0, seat: 0, result: 0 };
  const transport: MatchRecoveryDependencies['transport'] = {
    async activeMatch() {
      calls.active += 1;
      return { type: 'activeMatch', match };
    },
    async issueSeatToken() {
      calls.seat += 1;
      return seatTokenResponse();
    },
    async matchResult(matchId) {
      calls.result += 1;
      return { type: 'matchResult', matchId, result: options.result ?? null };
    },
    createSocket() {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  };
  const memory = options.storage ?? new MemoryStorage();
  const scheduler = new NoopScheduler();
  let random = 0;
  const controller = new MatchRecoveryController({
    transport,
    storage: new MatchRecoveryStorage(memory),
    scheduler,
    randomValues(bytes) {
      bytes.fill(random);
      random += 1;
      return bytes;
    },
    isOnline: () => true,
  });
  return { controller, calls, sockets, memory, scheduler };
}

async function reachOffer(controller: MatchRecoveryController): Promise<void> {
  controller.start();
  await Promise.resolve();
  await Promise.resolve();
  expect(controller.getSnapshot().phase).toBe('offer');
}

describe('OLG-133 recovery transport/storage', () => {
  it('relative same-origin requestだけを使い、seat tokenをURLやstorageへ出さない', async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const match = fixtureMatch();
    const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ input: String(input), init });
      const body = String(input).endsWith('/seat-token')
        ? seatTokenResponse()
        : String(input).endsWith('/result')
          ? { type: 'matchResult', matchId: match.matchId, result: null }
          : { type: 'activeMatch', match };
      return new Response(JSON.stringify(body), {
        status: String(input).endsWith('/seat-token') ? 201 : 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    let socketUrl = '';
    const transport = new BrowserMatchTransport({
      fetch,
      createSocket(url) { socketUrl = url; return new FakeSocket(); },
      location: { protocol: 'https:', host: 'play.example.test' },
      now: () => Date.parse('2026-08-02T00:00:00.000Z'),
    });

    await transport.activeMatch(new AbortController().signal);
    await transport.issueSeatToken(match.matchId, new AbortController().signal);
    await transport.matchResult(match.matchId, new AbortController().signal);
    transport.createSocket(match.matchId);

    expect(calls.map((call) => call.input)).toEqual([
      '/me/active-match',
      `/matches/${match.matchId}/seat-token`,
      `/matches/${match.matchId}/result`,
    ]);
    expect(calls[0]?.init).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
    expect(calls[1]?.init).toMatchObject({ method: 'POST', body: '{}', credentials: 'same-origin' });
    expect(new Headers(calls[1]?.init.headers).get(ONLINE_CLIENT_HEADER)).toBe(ONLINE_CLIENT_HEADER_VALUE);
    expect(new Headers(calls[1]?.init.headers).get('Content-Type')).toBe('application/json');
    expect(socketUrl).toBe(`wss://play.example.test/matches/${match.matchId}/ws`);
    expect(socketUrl).not.toContain(seatTokenResponse().seatToken);
    expect(JSON.stringify(calls)).not.toContain(seatTokenResponse().seatToken);
  });

  it('同じmatch/versionのcursorだけを読み、破損・別match・tokenらしき余分値を採用しない', () => {
    const memory = new MemoryStorage();
    const storage = new MatchRecoveryStorage(memory);
    const matchId = fixtureMatch().matchId;
    storage.writeCursor(matchId, 9);
    expect(storage.readCursor(matchId)).toBe(9);
    expect([...memory.values.values()].join('')).not.toContain('seatToken');

    const other = parseMatchId('other_match');
    if (!other) throw new Error('invalid other match fixture');
    expect(storage.readCursor(other)).toBe(0);
    const key = [...memory.values.keys()][0]!;
    memory.setItem(key, '{bad json');
    expect(storage.readCursor(matchId)).toBe(0);
    memory.setItem(key, JSON.stringify({
      matchId,
      seat: 'player-1',
      projectionVersion: MATCH_PLAYER_PROJECTION_VERSION - 1,
      viewerEventVersion: MATCH_VIEWER_EVENT_VERSION,
      eventSequence: 9,
    }));
    expect(storage.readCursor(matchId)).toBe(0);
  });

  it('401/429/503とmalformed responseを区別し、秘密を含む余分fieldをfail closedにする', async () => {
    const responses = [
      new Response('{}', { status: 401 }),
      new Response('{}', { status: 429, headers: { 'Retry-After': '2' } }),
      new Response('{}', { status: 503 }),
      new Response(JSON.stringify({
        type: 'activeMatch',
        match: null,
        seed: 'HIDDEN_CANARY',
      }), { status: 200 }),
    ];
    const transport = new BrowserMatchTransport({
      fetch: async () => responses.shift()!,
      createSocket: () => new FakeSocket(),
      location: { protocol: 'https:', host: 'play.example.test' },
      now: () => 0,
    });
    const active = () => transport.activeMatch(new AbortController().signal);
    await expect(active()).rejects.toMatchObject({ kind: 'session', status: 401 });
    await expect(active()).rejects.toMatchObject({
      kind: 'rate_limited',
      status: 429,
      retryAfterMs: 2_000,
    });
    await expect(active()).rejects.toMatchObject({ kind: 'temporary', status: 503 });
    await expect(active()).rejects.toMatchObject({ kind: 'protocol', status: 200 });
  });
});

describe('OLG-133 recovery machine', () => {
  it('active matchを1タップ・single-flightでresumeし、auth_okだけではreadyにしない', async () => {
    const { controller, calls, sockets, memory } = controllerFixture();
    await reachOffer(controller);
    const first = controller.resume();
    const second = controller.resume();
    await Promise.resolve();
    expect(first).toBe(second);
    expect(calls.seat).toBe(1);
    expect(sockets).toHaveLength(1);

    const socket = sockets[0]!;
    socket.open();
    expect(socket.sent).toHaveLength(1);
    const auth = parseMatchSeatAuthClientFrame(JSON.parse(socket.sent[0]!) as unknown);
    expect(auth?.resume?.lastEventSequence).toBe(0);
    expect([...memory.values.values()].join('')).not.toContain(seatTokenResponse().seatToken);
    socket.message(MATCH_AUTH_OK);
    expect(controller.getSnapshot().phase).toBe('connecting');

    socket.message(JSON.stringify(projectionFrame()));
    await expect(first).resolves.toBe(true);
    expect(controller.getSnapshot().phase).toBe('playing');
    expect(new MatchRecoveryStorage(memory).readCursor(fixtureMatch().matchId)).toBe(0);
  });

  it('接続中のeffect teardownで古いflightを完了し、再start後の新接続を妨げない', async () => {
    const { controller, sockets, calls } = controllerFixture();
    await reachOffer(controller);
    const oldFlight = controller.resume();
    await Promise.resolve();
    const oldSocket = sockets[0]!;
    controller.stop();
    await expect(oldFlight).resolves.toBe(false);
    expect(controller.getSnapshot()).toEqual({ phase: 'idle' });

    controller.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getSnapshot().phase).toBe('offer');
    const nextFlight = controller.resume();
    await Promise.resolve();
    const nextSocket = sockets[1]!;
    expect(calls.seat).toBe(2);
    oldSocket.open();
    oldSocket.message(MATCH_AUTH_OK);
    oldSocket.message(JSON.stringify(projectionFrame()));
    expect(controller.getSnapshot().phase).toBe('connecting');

    nextSocket.open();
    nextSocket.message(MATCH_AUTH_OK);
    nextSocket.message(JSON.stringify(projectionFrame()));
    await expect(nextFlight).resolves.toBe(true);
    expect(controller.getSnapshot().phase).toBe('playing');
  });

  it('reload後は保存cursorをversion付きauthへ載せ、hidden-only空batchでもcursorを進める', async () => {
    const memory = new MemoryStorage();
    new MatchRecoveryStorage(memory).writeCursor(fixtureMatch().matchId, 7);
    const { controller, sockets } = controllerFixture({ storage: memory });
    await reachOffer(controller);
    const ready = controller.resume();
    await Promise.resolve();
    const socket = sockets[0]!;
    socket.open();
    const auth = parseMatchSeatAuthClientFrame(JSON.parse(socket.sent[0]!) as unknown);
    expect(auth?.resume).toEqual({
      projectionVersion: MATCH_PLAYER_PROJECTION_VERSION,
      viewerEventVersion: MATCH_VIEWER_EVENT_VERSION,
      lastEventSequence: 7,
    });
    socket.message(MATCH_AUTH_OK);
    const projection = fixtureProjection({ eventSequence: 8 });
    socket.message(JSON.stringify({
      type: 'matchProjection',
      projection,
      sync: {
        type: 'matchViewerSync',
        mode: 'delta',
        afterEventSequence: 7,
        batches: [{ sequence: 8, events: [] }],
      },
    }));
    await expect(ready).resolves.toBe(true);
    expect(new MatchRecoveryStorage(memory).readCursor(fixtureMatch().matchId)).toBe(8);
  });

  it('保存cursorがserverより先ならcursor_ahead snapshotへ収束する', async () => {
    const memory = new MemoryStorage();
    new MatchRecoveryStorage(memory).writeCursor(fixtureMatch().matchId, 99);
    const { controller, sockets } = controllerFixture({ storage: memory });
    await reachOffer(controller);
    const ready = controller.resume();
    await Promise.resolve();
    const socket = sockets[0]!;
    socket.open();
    socket.message(MATCH_AUTH_OK);
    const projection = fixtureProjection({ eventSequence: 3 });
    socket.message(JSON.stringify({
      type: 'matchProjection',
      projection,
      sync: {
        type: 'matchViewerSync',
        mode: 'snapshot',
        reason: 'cursor_ahead',
        eventSequence: 3,
      },
    }));
    await expect(ready).resolves.toBe(true);
    expect(new MatchRecoveryStorage(memory).readCursor(fixtureMatch().matchId)).toBe(3);
  });

  it('wrong match/seat/delta baseをfail closedにしcursorを更新しない', async () => {
    const memory = new MemoryStorage();
    new MatchRecoveryStorage(memory).writeCursor(fixtureMatch().matchId, 4);
    const { controller, sockets } = controllerFixture({ storage: memory });
    await reachOffer(controller);
    const ready = controller.resume();
    await Promise.resolve();
    const socket = sockets[0]!;
    socket.open();
    socket.message(MATCH_AUTH_OK);
    socket.message(JSON.stringify(projectionFrame(fixtureProjection({ eventSequence: 5 }), 3)));
    await expect(ready).resolves.toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'error', kind: 'protocol', retryable: false });
    expect(new MatchRecoveryStorage(memory).readCursor(fixtureMatch().matchId)).toBe(4);
  });

  it('commandを1件ずつ送り、対応receiptのprojectionでpendingを解除する', async () => {
    const { controller, sockets } = controllerFixture();
    await reachOffer(controller);
    const ready = controller.resume();
    await Promise.resolve();
    const socket = sockets[0]!;
    socket.open();
    socket.message(MATCH_AUTH_OK);
    socket.message(JSON.stringify(projectionFrame()));
    await ready;
    const playing = controller.getSnapshot();
    if (playing.phase !== 'playing') throw new Error('expected playing state');
    const action = playing.projection.legalActions[0]!;
    expect(controller.sendAction(action)).toBe(true);
    expect(controller.sendAction(action)).toBe(false);
    expect(socket.sent).toHaveLength(2);
    const sentCommand = JSON.parse(socket.sent[1]!) as { command: { commandId: string } };
    const commandId = parseMatchCommandId(sentCommand.command.commandId);
    const nextRevision = parseMatchRevision(2);
    const baseRevision = parseMatchRevision(1);
    if (!commandId || nextRevision === null || baseRevision === null) throw new Error('invalid receipt fixture');
    const receipt: MatchCommandResult = {
      type: 'matchCommandResult',
      state: 'accepted',
      matchId: fixtureMatch().matchId,
      commandId,
      baseRevision,
      revision: nextRevision,
    };
    const projection = fixtureProjection({ revision: 2 });
    socket.message(JSON.stringify({
      type: 'matchCommandUpdate',
      receipt,
      projection,
      sync: {
        type: 'matchViewerSync',
        mode: 'delta',
        afterEventSequence: 0,
        batches: [],
      },
    }));
    expect(controller.getSnapshot()).toMatchObject({ phase: 'playing', pendingCommandId: null });
  });

  it('terminalはseat token/WSを作らずresultへ直行し、dismiss後は非表示にする', async () => {
    const result: MatchTerminalProjection = { state: 'finished', winner: 0, reason: 'wipeout' };
    const { controller, calls, sockets, memory } = controllerFixture({
      active: fixtureMatch('terminal'),
      result,
    });
    controller.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getSnapshot()).toMatchObject({ phase: 'terminal', result });
    expect(calls).toMatchObject({ seat: 0, result: 1 });
    expect(sockets).toHaveLength(0);
    controller.dismissTerminal();
    expect(controller.getSnapshot().phase).toBe('idle');
    expect(new MatchRecoveryStorage(memory).isTerminalDismissed(fixtureMatch().matchId)).toBe(true);
  });

  it('provisioningのbounded poll上限後は永久loadingにせず手動retryへ移る', async () => {
    const { controller, calls, scheduler } = controllerFixture({
      active: fixtureMatch('provisioning'),
    });
    controller.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getSnapshot().phase).toBe('provisioning');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(scheduler.runNext()).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(calls.active).toBe(6);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error',
      kind: 'temporary',
      retryable: true,
    });
    expect(scheduler.runNext()).toBe(false);
  });

  it('API未同居のfresh 401/404は通常ホーム、resume履歴がある401だけ期限切れ表示にする', async () => {
    const make = (memory: MemoryStorage, error: MatchTransportError) => new MatchRecoveryController({
      transport: {
        async activeMatch() { throw error; },
        async issueSeatToken() { throw new Error('must not issue'); },
        async matchResult() { throw new Error('must not fetch result'); },
        createSocket() { throw new Error('must not open socket'); },
      },
      storage: new MatchRecoveryStorage(memory),
      scheduler: new NoopScheduler(),
      randomValues: (bytes) => bytes,
      isOnline: () => true,
    });
    for (const error of [
      new MatchTransportError('session', 401),
      new MatchTransportError('missing', 404),
    ]) {
      const fresh = make(new MemoryStorage(), error);
      fresh.start();
      await Promise.resolve();
      await Promise.resolve();
      expect(fresh.getSnapshot()).toEqual({ phase: 'idle' });
    }

    const resumedMemory = new MemoryStorage();
    new MatchRecoveryStorage(resumedMemory).writeCursor(fixtureMatch().matchId, 2);
    const resumed = make(resumedMemory, new MatchTransportError('session', 401));
    resumed.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(resumed.getSnapshot()).toMatchObject({ phase: 'error', kind: 'session', retryable: false });
  });

  it('日本語CTA・busy disabled・alertをsemantic HTMLで出す', () => {
    const noop = () => undefined;
    const offer = renderToStaticMarkup(
      <RecoveryBanner
        snapshot={{ phase: 'offer', match: fixtureMatch() }}
        locale="ja-JP"
        onResume={noop}
        onRetry={noop}
        onOpen={noop}
        onDismiss={noop}
      />,
    );
    expect(offer).toContain('試合に戻る');
    expect(offer).toContain('<button');
    const busy = renderToStaticMarkup(
      <RecoveryBanner
        snapshot={{ phase: 'connecting', stage: 'sync', match: fixtureMatch() }}
        locale="ja-JP"
        onResume={noop}
        onRetry={noop}
        onOpen={noop}
        onDismiss={noop}
      />,
    );
    expect(busy).toContain('disabled=""');
    expect(busy).toContain('最新の盤面を同期');
    const failure = renderToStaticMarkup(
      <RecoveryBanner
        snapshot={{ phase: 'error', kind: 'offline', retryable: true, match: fixtureMatch(), projection: null }}
        locale="ja-JP"
        onResume={noop}
        onRetry={noop}
        onOpen={noop}
        onDismiss={noop}
      />,
    );
    expect(failure).toContain('role="alert"');
    expect(failure).toContain('通信を確認できません');
  });

  it('相手handが誤ってprivateで届いてもprintingIdをmarkupへ露出しない', () => {
    const projection = fixtureProjection();
    const projectionWithLeakedOpponentHand = {
      ...projection,
      players: [
        projection.players[0],
        {
          ...projection.players[1],
          hand: {
            visibility: 'private',
            cards: [{
              battleCardId: 'bc_00000000000000000000000000000001',
              printingId: 'HIDDEN_CANARY',
            }],
          },
        },
      ],
    } as unknown as MatchPlayerProjection;

    const markup = renderToStaticMarkup(
      <OnlineBattle
        projection={projectionWithLeakedOpponentHand}
        commandPending={false}
        onAction={() => undefined}
        onExit={() => undefined}
      />,
    );

    expect(markup).not.toContain('HIDDEN_CANARY');
  });

  it('不可逆操作は1回目に送らず、revision更新で解除し、2回目だけ送る', () => {
    const onAction = vi.fn();
    let renderer!: ReactTestRenderer;
    const battle = (projection: MatchPlayerProjection) => (
      <OnlineBattle
        projection={projection}
        commandPending={false}
        onAction={onAction}
        onExit={() => undefined}
      />
    );
    const phaseButton = () => {
      const button = renderer.root.findAllByType('button').find((node) =>
        typeof node.props.className === 'string' && node.props.className.includes('ob-action'));
      if (!button) throw new Error('phase action button not found');
      return button;
    };

    act(() => { renderer = create(battle(fixtureProjection({ revision: 1 }))); });
    act(() => { phaseButton().props.onClick(); });
    expect(onAction).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('もう一度押して確定');

    act(() => { renderer.update(battle(fixtureProjection({ revision: 2 }))); });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('もう一度押して確定');
    act(() => { phaseButton().props.onClick(); });
    expect(onAction).not.toHaveBeenCalled();
    act(() => { phaseButton().props.onClick(); });
    expect(onAction).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledWith({ type: 'endPlay' });
    act(() => { renderer.unmount(); });
  });

  it('ノッチ分を含むtopbar高を盤面とsticky操作で共有する', () => {
    expect(onlineCss).toContain('--ob-topbar-h: calc(51px + max(7px, env(safe-area-inset-top)))');
    expect(onlineCss).toContain('min-height: calc(100dvh - var(--ob-topbar-h))');
    expect(onlineCss).toContain('top: var(--ob-topbar-h)');
    expect(onlineCss).not.toMatch(/\.ob-action-panel\s*\{[^}]*top:\s*58px/s);
  });

  it('フェーズを確定する操作だけを誤タップ防止の2段階対象にする', () => {
    expect(actionNeedsConfirmation({ type: 'endPlay' })).toBe(true);
    expect(actionNeedsConfirmation({ type: 'pass' })).toBe(true);
    expect(actionNeedsConfirmation({ type: 'endTurn' })).toBe(true);
    expect(actionNeedsConfirmation({ type: 'skipTurnStart' })).toBe(false);
  });
});
