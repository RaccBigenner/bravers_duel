import type { MatchCommandCandidate, MatchCommandId, MatchRevision } from '@bravers/protocol';

export const MATCH_COMMAND_PAYLOAD_DOMAIN = 'bravers-match-command-v1' as const;
export const MAX_MATCH_COMMAND_CANONICAL_BYTES = 4_096;
export const MAX_MATCH_COMMAND_RECORDS = 2_048;
export const MAX_MATCH_COMMAND_REJECTION_RECORDS = 512;

const MAX_CANONICAL_DEPTH = 8;
const MAX_CANONICAL_NODES = 128;
const MAX_CANONICAL_OBJECT_KEYS = 32;
const MAX_CANONICAL_ARRAY_ITEMS = 64;
const MAX_CANONICAL_STRING_LENGTH = 512;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export type MatchCommandSeatId = 'player-1' | 'player-2';

export interface MatchCommandPayloadIdentity {
  canonicalPayload: string;
  payloadDigest: string;
}

export type MatchCommandLookup<Result> =
  | { state: 'miss' }
  | { state: 'replay'; result: Result }
  | { state: 'conflict'; originalRevision: MatchRevision };

export class MatchCommandPayloadError extends Error {
  constructor() {
    super('MATCH_COMMAND_PAYLOAD_INVALID');
    this.name = 'MatchCommandPayloadError';
  }
}

export class MatchCommandLedgerError extends Error {
  constructor(
    public readonly code:
      | 'MATCH_COMMAND_CAPACITY_EXCEEDED'
      | 'MATCH_COMMAND_REJECTION_CAPACITY_EXCEEDED'
      | 'MATCH_COMMAND_DUPLICATE',
  ) {
    super(code);
    this.name = 'MatchCommandLedgerError';
  }
}

interface CanonicalContext {
  readonly ancestors: Set<object>;
  nodes: number;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalJson(value: unknown, context: CanonicalContext, depth: number): string {
  context.nodes += 1;
  if (context.nodes > MAX_CANONICAL_NODES || depth > MAX_CANONICAL_DEPTH) {
    throw new MatchCommandPayloadError();
  }
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new MatchCommandPayloadError();
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    if (value.length > MAX_CANONICAL_STRING_LENGTH) throw new MatchCommandPayloadError();
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new MatchCommandPayloadError();
  if (context.ancestors.has(value)) throw new MatchCommandPayloadError();
  context.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_CANONICAL_ARRAY_ITEMS) throw new MatchCommandPayloadError();
      const ownKeys = Reflect.ownKeys(value);
      if (
        ownKeys.length !== value.length + 1 ||
        !ownKeys.includes('length') ||
        ownKeys.some(
          (key) =>
            key !== 'length' &&
            (typeof key !== 'string' ||
              !/^(0|[1-9][0-9]*)$/.test(key) ||
              Number(key) >= value.length ||
              !Object.prototype.propertyIsEnumerable.call(value, key)),
        )
      ) {
        throw new MatchCommandPayloadError();
      }
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        if (
          !Object.hasOwn(value, key) ||
          !Object.prototype.propertyIsEnumerable.call(value, key)
        ) {
          throw new MatchCommandPayloadError();
        }
        items.push(canonicalJson(value[index], context, depth + 1));
      }
      return `[${items.join(',')}]`;
    }
    if (!plainObject(value)) throw new MatchCommandPayloadError();
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.some(
        (key) =>
          typeof key !== 'string' ||
          !Object.prototype.propertyIsEnumerable.call(value, key),
      )
    ) {
      throw new MatchCommandPayloadError();
    }
    const keys = ownKeys as string[];
    if (keys.length > MAX_CANONICAL_OBJECT_KEYS) throw new MatchCommandPayloadError();
    keys.sort();
    return `{${keys
      .map((key) => {
        if (key.length > MAX_CANONICAL_STRING_LENGTH) throw new MatchCommandPayloadError();
        return `${JSON.stringify(key)}:${canonicalJson(value[key], context, depth + 1)}`;
      })
      .join(',')}}`;
  } finally {
    context.ancestors.delete(value);
  }
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

/**
 * 同じJSON値はkey順に依存せず同じidentityになる。seatをdomainへ含め、将来のPvPでも
 * 別seatのcommandId衝突からcached responseを返さない。
 */
export async function identifyMatchCommandPayload(
  candidate: MatchCommandCandidate,
  seatId: MatchCommandSeatId,
): Promise<MatchCommandPayloadIdentity> {
  const canonicalPayload = canonicalJson(
    [
      MATCH_COMMAND_PAYLOAD_DOMAIN,
      candidate.matchId,
      seatId,
      candidate.expectedRevision,
      candidate.action,
    ],
    { ancestors: new Set(), nodes: 0 },
    0,
  );
  if (new TextEncoder().encode(canonicalPayload).byteLength > MAX_MATCH_COMMAND_CANONICAL_BYTES) {
    throw new MatchCommandPayloadError();
  }
  const payloadDigest = hex(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPayload)),
  );
  if (!SHA256_HEX_PATTERN.test(payloadDigest)) throw new MatchCommandPayloadError();
  return { canonicalPayload, payloadDigest };
}

interface StoredCommand<Result> {
  identity: MatchCommandPayloadIdentity;
  result: Result;
}

type RevisionedMatchCommandLedgerResult = {
  state: 'accepted' | 'rejected';
  revision: MatchRevision;
};

/** OLG-122ではDO生存中の台帳。OLG-125で同じrecordをSQLite transactionへ移す。 */
export class MatchCommandLedger<Result extends RevisionedMatchCommandLedgerResult> {
  private readonly records = new Map<MatchCommandId, StoredCommand<Result>>();
  private rejectedRecords = 0;

  constructor(
    private readonly capacity = MAX_MATCH_COMMAND_RECORDS,
    private readonly rejectionCapacity = Math.min(
      MAX_MATCH_COMMAND_REJECTION_RECORDS,
      capacity - 1,
    ),
  ) {
    if (
      !Number.isSafeInteger(capacity) ||
      capacity < 1 ||
      !Number.isSafeInteger(rejectionCapacity) ||
      rejectionCapacity < 0 ||
      rejectionCapacity >= capacity
    ) {
      throw new MatchCommandLedgerError('MATCH_COMMAND_CAPACITY_EXCEEDED');
    }
  }

  get size(): number {
    return this.records.size;
  }

  get rejectedSize(): number {
    return this.rejectedRecords;
  }

  hasCapacity(state?: Result['state']): boolean {
    return (
      this.records.size < this.capacity &&
      (state !== 'rejected' || this.rejectedRecords < this.rejectionCapacity)
    );
  }

  lookup(
    commandId: MatchCommandId,
    identity: MatchCommandPayloadIdentity,
  ): MatchCommandLookup<Result> {
    const stored = this.records.get(commandId);
    if (!stored) return { state: 'miss' };
    if (
      stored.identity.payloadDigest !== identity.payloadDigest ||
      stored.identity.canonicalPayload !== identity.canonicalPayload
    ) {
      return { state: 'conflict', originalRevision: stored.result.revision };
    }
    return { state: 'replay', result: structuredClone(stored.result) };
  }

  remember(
    commandId: MatchCommandId,
    identity: MatchCommandPayloadIdentity,
    result: Result,
  ): Result {
    if (this.records.has(commandId)) {
      throw new MatchCommandLedgerError('MATCH_COMMAND_DUPLICATE');
    }
    if (this.records.size >= this.capacity) {
      throw new MatchCommandLedgerError('MATCH_COMMAND_CAPACITY_EXCEEDED');
    }
    if (result.state === 'rejected' && this.rejectedRecords >= this.rejectionCapacity) {
      throw new MatchCommandLedgerError('MATCH_COMMAND_REJECTION_CAPACITY_EXCEEDED');
    }
    const stored = structuredClone({ identity, result });
    this.records.set(commandId, stored);
    if (stored.result.state === 'rejected') this.rejectedRecords += 1;
    return structuredClone(stored.result);
  }

  clear(): void {
    this.records.clear();
    this.rejectedRecords = 0;
  }
}
