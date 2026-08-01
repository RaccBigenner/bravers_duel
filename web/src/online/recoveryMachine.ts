import {
  MATCH_AUTH_OK,
  createSeatAuthFrame,
  parseMatchCommandClientFrame,
  parseMatchCommandId,
  parseMatchServerFrame,
  serializeMatchSeatAuthClientFrame,
  type ActiveMatchDescriptor,
  type MatchAction,
  type MatchCommandId,
  type MatchId,
  type MatchPlayerProjection,
  type MatchTerminalProjection,
  type MatchViewerEvent,
} from '@bravers/protocol';
import {
  BrowserMatchTransport,
  MatchTransportError,
  type MatchSocketLike,
} from './matchTransport';
import { MatchRecoveryStorage } from './recoveryStorage';

export type RecoveryErrorKind =
  | 'offline'
  | 'temporary'
  | 'session'
  | 'unavailable'
  | 'protocol';

interface MatchStateBase {
  match: ActiveMatchDescriptor;
}

export type RecoverySnapshot =
  | { phase: 'checking' }
  | { phase: 'idle' }
  | ({ phase: 'provisioning' } & MatchStateBase)
  | ({ phase: 'offer' } & MatchStateBase)
  | ({ phase: 'connecting'; stage: 'seat' | 'socket' | 'sync' } & MatchStateBase)
  | ({
      phase: 'playing';
      projection: MatchPlayerProjection;
      recentEvents: MatchViewerEvent[];
      pendingCommandId: MatchCommandId | null;
      commandError: 'rejected' | 'send_failed' | null;
    } & MatchStateBase)
  | ({ phase: 'terminal-loading' } & MatchStateBase)
  | ({ phase: 'terminal'; result: MatchTerminalProjection | null } & MatchStateBase)
  | ({
      phase: 'error';
      kind: RecoveryErrorKind;
      retryable: boolean;
      match: ActiveMatchDescriptor | null;
      projection: MatchPlayerProjection | null;
    });

export interface RecoveryScheduler {
  schedule(callback: () => void, delayMs: number): () => void;
}

export interface MatchRecoveryDependencies {
  transport: Pick<
    BrowserMatchTransport,
    'activeMatch' | 'issueSeatToken' | 'matchResult' | 'createSocket'
  >;
  storage: MatchRecoveryStorage;
  scheduler: RecoveryScheduler;
  randomValues(bytes: Uint8Array): Uint8Array;
  isOnline(): boolean;
}

type Listener = () => void;

const terminalDescriptor = (match: ActiveMatchDescriptor): ActiveMatchDescriptor => ({
  ...match,
  state: 'terminal',
});

function eventDelta(frame: ReturnType<typeof parseMatchServerFrame>): MatchViewerEvent[] {
  if (!frame || frame.sync.mode !== 'delta') return [];
  return frame.sync.batches.flatMap((batch) => batch.events).slice(-16);
}

function sameAction(left: MatchAction, right: MatchAction): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

export class MatchRecoveryController {
  private snapshot: RecoverySnapshot = { phase: 'checking' };
  private readonly listeners = new Set<Listener>();
  private operation = 0;
  private request: AbortController | null = null;
  private socket: MatchSocketLike | null = null;
  private socketIntentionalClose = false;
  private cancelSocketDeadline: (() => void) | null = null;
  private cancelProvisioningPoll: (() => void) | null = null;
  private resumeFlight: Promise<boolean> | null = null;
  private finishResume: ((ready: boolean) => void) | null = null;
  private expectedCursor = 0;
  private provisioningPolls = 0;

  constructor(private readonly dependencies: MatchRecoveryDependencies) {}

  getSnapshot = (): RecoverySnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(snapshot: RecoverySnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  start(): void {
    if (this.snapshot.phase === 'playing' || this.snapshot.phase === 'connecting') return;
    void this.discover();
  }

  stop(): void {
    this.operation += 1;
    this.request?.abort();
    this.request = null;
    this.cancelProvisioningPoll?.();
    this.cancelProvisioningPoll = null;
    this.closeSocket();
    this.finishResume?.(false);
    this.finishResume = null;
    this.resumeFlight = null;
    this.publish({ phase: 'idle' });
  }

  async refresh(): Promise<void> {
    if (
      this.snapshot.phase === 'playing' ||
      this.snapshot.phase === 'connecting' ||
      this.snapshot.phase === 'terminal-loading'
    ) {
      return;
    }
    await this.discover(true);
  }

  private async discover(quiet = false): Promise<void> {
    const operation = ++this.operation;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.cancelProvisioningPoll?.();
    this.cancelProvisioningPoll = null;
    if (!quiet) this.publish({ phase: 'checking' });

    try {
      const response = await this.dependencies.transport.activeMatch(request.signal);
      if (operation !== this.operation || request.signal.aborted) return;
      this.request = null;
      const match = response.match;
      if (!match) {
        this.provisioningPolls = 0;
        this.publish({ phase: 'idle' });
        return;
      }
      if (match.state === 'provisioning') {
        this.publish({ phase: 'provisioning', match });
        if (this.provisioningPolls < 5) {
          this.provisioningPolls += 1;
          this.cancelProvisioningPoll = this.dependencies.scheduler.schedule(() => {
            this.cancelProvisioningPoll = null;
            void this.discover(true);
          }, 1_000);
        } else {
          this.publish({
            phase: 'error',
            kind: 'temporary',
            retryable: true,
            match,
            projection: null,
          });
        }
        return;
      }
      this.provisioningPolls = 0;
      if (match.state === 'terminal') {
        if (this.dependencies.storage.isTerminalDismissed(match.matchId)) {
          this.publish({ phase: 'idle' });
          return;
        }
        await this.loadTerminal(match, operation);
        return;
      }
      this.publish({ phase: 'offer', match });
    } catch (error) {
      if (operation !== this.operation || request.signal.aborted) return;
      this.request = null;
      if (
        error instanceof MatchTransportError &&
        (error.kind === 'session' || error.kind === 'missing') &&
        !this.dependencies.storage.hasValidCursor()
      ) {
        this.publish({ phase: 'idle' });
        return;
      }
      this.publish(this.errorSnapshot(error, null, null));
    }
  }

  resume(): Promise<boolean> {
    if (this.snapshot.phase === 'playing') return Promise.resolve(true);
    if (this.resumeFlight) return this.resumeFlight;
    const match =
      this.snapshot.phase === 'offer'
        ? this.snapshot.match
        : this.snapshot.phase === 'error' && this.snapshot.match?.state === 'active'
          ? this.snapshot.match
          : null;
    if (!match) return Promise.resolve(false);
    const flight = this.connect(match);
    const tracked = flight.finally(() => {
      if (this.resumeFlight === tracked) this.resumeFlight = null;
    });
    this.resumeFlight = tracked;
    return tracked;
  }

  async retry(): Promise<boolean> {
    if (this.snapshot.phase === 'terminal') {
      await this.loadTerminal(this.snapshot.match, ++this.operation);
      return this.snapshot.phase === 'terminal';
    }
    await this.discover();
    return this.snapshot.phase === 'offer' ? this.resume() : false;
  }

  dismissTerminal(): void {
    if (this.snapshot.phase !== 'terminal') return;
    this.dependencies.storage.dismissTerminal(this.snapshot.match.matchId);
    this.dependencies.storage.clearCursor(this.snapshot.match.matchId);
    this.publish({ phase: 'idle' });
  }

  sendAction(action: MatchAction): boolean {
    const current = this.snapshot;
    if (
      current.phase !== 'playing' ||
      current.projection.terminal !== null ||
      current.pendingCommandId !== null ||
      !current.projection.legalActions.some((candidate) => sameAction(candidate, action)) ||
      !this.socket
    ) {
      return false;
    }
    const bytes = new Uint8Array(16);
    try {
      this.dependencies.randomValues(bytes);
    } catch {
      this.publish({ ...current, commandError: 'send_failed' });
      return false;
    }
    const commandId = parseMatchCommandId(
      `cmd_${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`,
    );
    if (!commandId) {
      this.publish({ ...current, commandError: 'send_failed' });
      return false;
    }
    const frame = parseMatchCommandClientFrame({
      type: 'matchCommand',
      command: {
        matchId: current.projection.matchId,
        commandId,
        expectedRevision: current.projection.revision,
        action,
      },
    });
    if (!frame) {
      this.publish({ ...current, commandError: 'send_failed' });
      return false;
    }
    try {
      this.socket.send(JSON.stringify(frame));
      this.publish({
        ...current,
        pendingCommandId: commandId,
        commandError: null,
      });
      return true;
    } catch {
      this.publish({ ...current, commandError: 'send_failed' });
      return false;
    }
  }

  private async connect(match: ActiveMatchDescriptor): Promise<boolean> {
    const operation = ++this.operation;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.closeSocket();
    this.publish({ phase: 'connecting', stage: 'seat', match });

    let issued;
    try {
      issued = await this.dependencies.transport.issueSeatToken(match.matchId, request.signal);
    } catch (error) {
      if (operation === this.operation && !request.signal.aborted) {
        this.request = null;
        this.publish(this.errorSnapshot(error, match, null));
      }
      return false;
    }
    if (operation !== this.operation || request.signal.aborted) return false;
    this.request = null;
    this.expectedCursor = this.dependencies.storage.readCursor(match.matchId);

    let socket: MatchSocketLike;
    try {
      socket = this.dependencies.transport.createSocket(match.matchId);
    } catch (error) {
      this.publish(this.errorSnapshot(error, match, null));
      return false;
    }
    this.socket = socket;
    this.socketIntentionalClose = false;
    socket.binaryType = 'arraybuffer';
    this.publish({ phase: 'connecting', stage: 'socket', match });

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      let authenticated = false;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        if (this.finishResume === finish) this.finishResume = null;
        resolve(ready);
      };
      this.finishResume = finish;
      const fail = (kind: RecoveryErrorKind, retryable: boolean) => {
        if (operation !== this.operation) return;
        this.cancelSocketDeadline?.();
        this.cancelSocketDeadline = null;
        this.closeSocket();
        this.publish({ phase: 'error', kind, retryable, match, projection: null });
        finish(false);
      };

      this.cancelSocketDeadline = this.dependencies.scheduler.schedule(
        () => fail(this.dependencies.isOnline() ? 'temporary' : 'offline', true),
        4_500,
      );

      socket.onopen = () => {
        if (operation !== this.operation || socket !== this.socket) return;
        const frame = createSeatAuthFrame(issued.seatToken, this.expectedCursor);
        const encoded = serializeMatchSeatAuthClientFrame(frame);
        if (!encoded) {
          fail('protocol', false);
          return;
        }
        try {
          // auth deadlineは5秒。open callback内でawaitせず、最初のmessageとして即送る。
          socket.send(encoded);
          this.publish({ phase: 'connecting', stage: 'sync', match });
        } catch {
          fail(this.dependencies.isOnline() ? 'temporary' : 'offline', true);
        }
      };

      socket.onmessage = (event) => {
        if (operation !== this.operation || socket !== this.socket) return;
        if (event.data === MATCH_AUTH_OK) {
          if (authenticated) {
            fail('protocol', false);
            return;
          }
          authenticated = true;
          this.cancelSocketDeadline?.();
          this.cancelSocketDeadline = this.dependencies.scheduler.schedule(
            () => fail(this.dependencies.isOnline() ? 'temporary' : 'offline', true),
            8_000,
          );
          return;
        }
        if (!authenticated || typeof event.data !== 'string' || event.data.length > 512 * 1024) {
          fail('protocol', false);
          return;
        }
        let raw: unknown;
        try {
          raw = JSON.parse(event.data) as unknown;
        } catch {
          fail('protocol', false);
          return;
        }
        const frame = parseMatchServerFrame(raw);
        const previous = this.snapshot.phase === 'playing' ? this.snapshot : null;
        if (
          !frame ||
          frame.projection.matchId !== match.matchId ||
          frame.projection.viewerSeat !== 'player-1' ||
          (frame.sync.mode === 'delta' && frame.sync.afterEventSequence !== this.expectedCursor) ||
          (previous !== null &&
            (frame.projection.revision < previous.projection.revision ||
              frame.projection.eventSequence < previous.projection.eventSequence))
        ) {
          fail('protocol', false);
          return;
        }
        this.expectedCursor = frame.projection.eventSequence;
        const pending = previous?.pendingCommandId ?? null;
        const receiptForPending =
          frame.type === 'matchCommandUpdate' && pending !== null && frame.receipt.commandId === pending;
        const commandError = receiptForPending && frame.receipt.state === 'rejected'
          ? 'rejected'
          : previous?.commandError ?? null;
        const recentEvents = [
          ...(previous?.recentEvents ?? []),
          ...eventDelta(frame),
        ].slice(-16);
        this.publish({
          phase: 'playing',
          match,
          projection: frame.projection,
          recentEvents,
          pendingCommandId: receiptForPending ? null : pending,
          commandError,
        });
        // projectionと同じ同期commitの直後に、そのprojection自身のcursorだけを保存する。
        this.dependencies.storage.writeCursor(match.matchId, frame.projection.eventSequence);
        this.cancelSocketDeadline?.();
        this.cancelSocketDeadline = null;
        finish(true);
        if (frame.projection.terminal) {
          this.closeSocket();
          void this.loadTerminal(terminalDescriptor(match), ++this.operation);
        }
      };

      socket.onerror = () => {
        // BrowserはhandshakeのHTTP statusを隠す。closeを待って分類する。
      };

      socket.onclose = (event) => {
        if (operation !== this.operation || this.socketIntentionalClose) return;
        this.socket = null;
        this.cancelSocketDeadline?.();
        this.cancelSocketDeadline = null;
        if (event.code === 1000 && event.reason === 'MATCH_ENDED') {
          finish(true);
          void this.loadTerminal(terminalDescriptor(match), ++this.operation);
          return;
        }
        if (event.code === 1008 && event.reason === 'SESSION_ENDED') {
          this.publish({ phase: 'error', kind: 'session', retryable: false, match, projection: null });
          finish(false);
          return;
        }
        if (event.code === 1008 && event.reason === 'SEAT_REASSIGNED') {
          finish(false);
          void this.discover();
          return;
        }
        if (
          (event.code === 1008 && event.reason === 'MATCH_FRAME_INVALID') ||
          event.code === 1009
        ) {
          this.publish({ phase: 'error', kind: 'protocol', retryable: false, match, projection: null });
          finish(false);
          return;
        }
        const previousProjection = this.snapshot.phase === 'playing'
          ? this.snapshot.projection
          : null;
        this.publish({
          phase: 'error',
          kind: this.dependencies.isOnline() ? 'temporary' : 'offline',
          retryable: true,
          match,
          projection: previousProjection,
        });
        finish(false);
      };
    });
  }

  private async loadTerminal(match: ActiveMatchDescriptor, operation: number): Promise<void> {
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    const terminalMatch = terminalDescriptor(match);
    this.publish({ phase: 'terminal-loading', match: terminalMatch });
    try {
      const response = await this.dependencies.transport.matchResult(match.matchId, request.signal);
      if (operation !== this.operation || request.signal.aborted) return;
      this.request = null;
      this.dependencies.storage.clearCursor(match.matchId);
      this.publish({ phase: 'terminal', match: terminalMatch, result: response.result });
    } catch (error) {
      if (operation !== this.operation || request.signal.aborted) return;
      this.request = null;
      this.publish(this.errorSnapshot(error, terminalMatch, null));
    }
  }

  private errorSnapshot(
    error: unknown,
    match: ActiveMatchDescriptor | null,
    projection: MatchPlayerProjection | null,
  ): Extract<RecoverySnapshot, { phase: 'error' }> {
    if (!(error instanceof MatchTransportError)) {
      return {
        phase: 'error',
        kind: this.dependencies.isOnline() ? 'temporary' : 'offline',
        retryable: true,
        match,
        projection,
      };
    }
    switch (error.kind) {
      case 'session':
        return { phase: 'error', kind: 'session', retryable: false, match, projection };
      case 'missing':
        return { phase: 'error', kind: 'unavailable', retryable: true, match, projection };
      case 'protocol':
        return { phase: 'error', kind: 'protocol', retryable: false, match, projection };
      case 'rate_limited':
      case 'temporary':
        return {
          phase: 'error',
          kind: this.dependencies.isOnline() ? 'temporary' : 'offline',
          retryable: true,
          match,
          projection,
        };
    }
  }

  private closeSocket(): void {
    this.cancelSocketDeadline?.();
    this.cancelSocketDeadline = null;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    this.socketIntentionalClose = true;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close(1000, 'CLIENT_NAVIGATION');
    } catch {
      // close失敗はserver正本へ影響しない。
    }
  }
}

export function createMatchRecoveryController(): MatchRecoveryController {
  return new MatchRecoveryController({
    transport: new BrowserMatchTransport({
      fetch: window.fetch.bind(window),
      createSocket: (url) => new WebSocket(url),
      location: window.location,
      now: () => Date.now(),
    }),
    storage: new MatchRecoveryStorage(window.sessionStorage),
    scheduler: {
      schedule(callback, delayMs) {
        const timeout = window.setTimeout(callback, delayMs);
        return () => window.clearTimeout(timeout);
      },
    },
    randomValues: (bytes) => window.crypto.getRandomValues(bytes),
    isOnline: () => window.navigator.onLine,
  });
}
