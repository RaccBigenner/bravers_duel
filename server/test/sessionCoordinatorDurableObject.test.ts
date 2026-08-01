import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_SESSION_MATCH_REGISTRATIONS_PER_MATCH,
  MAX_SESSION_MATCH_REFERENCES,
  MAX_TRACKED_CANCELLED_MATCH_FLOORS,
  NPC_MATCH_RECOVERY_RETENTION_MS,
  type SessionCoordinatorDO,
} from '../src/session/sessionCoordinatorDurableObject';

type CoordinatorStub = DurableObjectStub<SessionCoordinatorDO>;
let referenceEpochMs = Date.now();

function coordinator(sessionId: string): CoordinatorStub {
  return env.SESSION_COORDINATOR_DO.get(
    env.SESSION_COORDINATOR_DO.idFromName(sessionId),
  );
}

function reference(
  sessionId: string,
  matchId: string,
  sessionVersion = 1,
  registrationId = crypto.randomUUID(),
) {
  referenceEpochMs += 1;
  return {
    sessionId,
    sessionVersion,
    matchId,
    registrationId,
    registrationEpochMs: referenceEpochMs,
  };
}

describe('OLG-113 SessionCoordinatorDO', () => {
  it('named DOのsession identityをRPC inputへ完全一致させる', async () => {
    const boundSessionId = crypto.randomUUID();
    const differentSessionId = crypto.randomUUID();

    const result = await runInDurableObject(
      coordinator(boundSessionId),
      async (instance) => {
        try {
          await (instance as SessionCoordinatorDO).registerMatch({
            sessionId: differentSessionId,
            sessionVersion: 1,
            matchId: 'identity-mismatch',
            registrationId: crypto.randomUUID(),
            registrationEpochMs: Date.now(),
          });
          return 'accepted';
        } catch (error) {
          return error instanceof Error ? error.message : 'unknown';
        }
      },
    );
    expect(result).toBe('SESSION_COORDINATOR_IDENTITY_INVALID');
  });

  it('match参照を上限内に抑え、同じ参照の再送とversion付き解除は冪等', async () => {
    const sessionId = crypto.randomUUID();
    const stub = coordinator(sessionId);
    const references = Array.from(
      { length: MAX_SESSION_MATCH_REFERENCES },
      (_, index) => reference(sessionId, `bounded-${index}`),
    );
    for (let index = 0; index < MAX_SESSION_MATCH_REFERENCES; index += 1) {
      await expect(
        stub.registerMatch(references[index]!),
      ).resolves.toEqual({ state: 'registered' });
    }

    await expect(
      stub.registerMatch(references[0]!),
    ).resolves.toEqual({ state: 'registered' });
    await expect(
      stub.registerMatch(reference(sessionId, 'over-capacity')),
    ).resolves.toEqual({ state: 'capacity_exceeded' });

    await expect(
      stub.unregisterMatch({ ...references[0]!, sessionVersion: 2 }),
    ).resolves.toEqual({ state: 'acknowledged' });
    await expect(
      stub.registerMatch(reference(sessionId, 'still-full')),
    ).resolves.toEqual({ state: 'capacity_exceeded' });

    await stub.unregisterMatch(references[0]!);
    await expect(
      stub.registerMatch(reference(sessionId, 'replacement')),
    ).resolves.toEqual({ state: 'registered' });
  });

  it('古いassignment登録の遅延解除が同versionの新登録を消さない', async () => {
    const sessionId = crypto.randomUUID();
    const matchId = 'registration-generation-race';
    const stub = coordinator(sessionId);
    const oldReference = reference(sessionId, matchId);
    const activeReference = reference(sessionId, matchId);

    await stub.registerMatch(oldReference);
    await stub.registerMatch(activeReference);
    await stub.unregisterMatch(oldReference);

    await expect(stub.checkMatch(activeReference)).resolves.toEqual({ state: 'registered' });
    await expect(stub.checkMatch(oldReference)).resolves.toEqual({ state: 'missing' });
    await expect(stub.registerMatch(oldReference)).resolves.toEqual({
      state: 'cancelled',
      cancelledThroughEpochMs: oldReference.registrationEpochMs,
    });
    const olderUnknown = {
      ...reference(sessionId, matchId),
      registrationEpochMs: oldReference.registrationEpochMs - 1,
    };
    await expect(stub.registerMatch(olderUnknown)).resolves.toEqual({
      state: 'cancelled',
      cancelledThroughEpochMs: oldReference.registrationEpochMs,
    });
    const newer = {
      ...reference(sessionId, matchId),
      registrationEpochMs: Math.max(
        referenceEpochMs,
        oldReference.registrationEpochMs + 1,
      ),
    };
    await expect(stub.registerMatch(newer)).resolves.toEqual({ state: 'registered' });
    await expect(stub.checkMatch(activeReference)).resolves.toEqual({ state: 'registered' });
  });

  it('取消floorより古い既存exact参照は維持し、未登録の遅延参照だけを拒否する', async () => {
    const sessionId = crypto.randomUUID();
    const stub = coordinator(sessionId);
    const activeReference = reference(sessionId, 'active-below-floor');
    const laterCancellation = reference(sessionId, 'unknown-later-cancellation');

    await expect(stub.registerMatch(activeReference)).resolves.toEqual({
      state: 'registered',
    });
    await expect(stub.unregisterMatch(laterCancellation)).resolves.toEqual({
      state: 'acknowledged',
    });

    await expect(stub.registerMatch(activeReference)).resolves.toEqual({
      state: 'registered',
    });
    await expect(stub.checkMatch(activeReference)).resolves.toEqual({
      state: 'registered',
    });
    await expect(stub.registerMatch(laterCancellation)).resolves.toEqual({
      state: 'cancelled',
      cancelledThroughEpochMs: laterCancellation.registrationEpochMs,
    });
  });

  it('取消floorはmatchId単位に閉じ、無関係な別matchの初回登録を巻き込まない', async () => {
    const sessionId = crypto.randomUUID();
    const stub = coordinator(sessionId);
    const matchA = 'floor-owner-match';
    const matchB = 'unrelated-new-match';

    const matchAReference = reference(sessionId, matchA);
    await expect(stub.registerMatch(matchAReference)).resolves.toEqual({
      state: 'registered',
    });
    // matchAだけを対象に、matchB用epochより十分高い取消floorを積む。
    const matchAInflatedCancellation = {
      ...reference(sessionId, matchA),
      registrationEpochMs: matchAReference.registrationEpochMs + 10_000,
    };
    await expect(
      stub.unregisterMatch(matchAInflatedCancellation),
    ).resolves.toEqual({ state: 'acknowledged' });

    // matchBは一度も登録・取消されていない全く別のmatch。epochがmatchAのfloorより
    // 低くても、matchBの初回登録はmatchAのfloorに巻き込まれず成立するべき。
    const matchBReference = {
      ...reference(sessionId, matchB),
      registrationEpochMs: matchAReference.registrationEpochMs + 1,
    };
    await expect(stub.registerMatch(matchBReference)).resolves.toEqual({
      state: 'registered',
    });
    await expect(stub.checkMatch(matchBReference)).resolves.toEqual({
      state: 'registered',
    });

    // matchA自身は引き続き自分のfloorで守られている。
    await expect(stub.registerMatch(matchAInflatedCancellation)).resolves.toEqual({
      state: 'cancelled',
      cancelledThroughEpochMs: matchAInflatedCancellation.registrationEpochMs,
    });
  });

  it('取消floorはmatchId件数を上限内に間引き、溢れても新しいfloorは効き続ける', async () => {
    const sessionId = crypto.randomUUID();
    const stub = coordinator(sessionId);

    const cancellations = Array.from(
      { length: MAX_TRACKED_CANCELLED_MATCH_FLOORS + 1 },
      (_, index) => reference(sessionId, `floor-churn-${index}`),
    );
    for (const cancellation of cancellations) {
      await expect(stub.unregisterMatch(cancellation)).resolves.toEqual({
        state: 'acknowledged',
      });
    }

    // 最も古いfloor(先頭)は間引かれ、遅延registerが素通りするようになる。
    const oldest = cancellations[0]!;
    await expect(stub.registerMatch(oldest)).resolves.toEqual({ state: 'registered' });
    await expect(stub.unregisterMatch(oldest)).resolves.toEqual({ state: 'acknowledged' });

    // 直近のfloorは残っており、引き続き遅延registerを拒否する。
    const newest = cancellations[cancellations.length - 1]!;
    await expect(stub.registerMatch(newest)).resolves.toEqual({
      state: 'cancelled',
      cancelledThroughEpochMs: newest.registrationEpochMs,
    });
  });

  it('同一matchの応答喪失中IDをboundedに保ち、logout fan-outは1 DOへ重複排除する', async () => {
    const sessionId = crypto.randomUUID();
    const matchId = `dedup-${crypto.randomUUID().slice(0, 8)}`;
    const stub = coordinator(sessionId);
    for (
      let index = 0;
      index < MAX_SESSION_MATCH_REGISTRATIONS_PER_MATCH;
      index += 1
    ) {
      await expect(
        stub.registerMatch(reference(sessionId, matchId)),
      ).resolves.toEqual({ state: 'registered' });
    }
    await expect(
      stub.registerMatch(reference(sessionId, matchId)),
    ).resolves.toEqual({ state: 'capacity_exceeded' });

    await expect(
      stub.invalidateSession({ sessionId, invalidatedVersion: 2 }),
    ).resolves.toEqual({
      state: 'acknowledged',
      invalidatedVersion: 2,
      matchedObjects: 1,
    });
  });

  it('失効version未満だけを拒否し、同じversionの登録は許す', async () => {
    const sessionId = crypto.randomUUID();
    const stub = coordinator(sessionId);
    const staleReference = reference(sessionId, 'stale-version');
    await expect(
      stub.invalidateSession({ sessionId, invalidatedVersion: 2 }),
    ).resolves.toEqual({
      state: 'acknowledged',
      invalidatedVersion: 2,
      matchedObjects: 0,
    });

    await expect(
      stub.registerMatch(staleReference),
    ).resolves.toEqual({ state: 'invalidated', invalidatedVersion: 2 });
    await expect(stub.checkMatch(staleReference)).resolves.toEqual({
      state: 'invalidated',
      invalidatedVersion: 2,
    });
    await expect(
      stub.registerMatch(reference(sessionId, 'equal-version', 2)),
    ).resolves.toEqual({ state: 'registered' });
  });

  it('古いdirect失効が先置き済みのDB revoke intentを消さない', async () => {
    const sessionId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const matchId = `stale-direct-${crypto.randomUUID().slice(0, 8)}`;
    const stub = coordinator(sessionId);
    const intent = {
      sessionId,
      accountId,
      sessionVersion: 3,
      sessionDigestHex: 'ef'.repeat(32),
      sessionDigestKeyVersion: 1,
    };
    await stub.registerMatch(reference(sessionId, matchId, 3));
    await stub.prepareLogout(intent);

    await expect(
      stub.invalidateSession({ sessionId, invalidatedVersion: 3 }),
    ).resolves.toEqual({
      state: 'pending',
      invalidatedVersion: 4,
      pendingObjects: 1,
    });

    const pending = await runInDurableObject(stub, async (_instance, state) => ({
      values: [...(await state.storage.list()).values()],
      alarm: await state.storage.getAlarm(),
    }));
    expect(pending.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: 'revoke_pending',
          sessionVersion: 3,
          sessionDigestHex: intent.sessionDigestHex,
        }),
      ]),
    );
    expect(pending.alarm).toEqual(expect.any(Number));
    await expect(
      stub.registerMatch(reference(sessionId, 'blocked-after-stale', 3)),
    ).resolves.toEqual({ state: 'invalidated', invalidatedVersion: 4 });
  });

  it('DB revoke待ちへ入った時点でexact参照のread-only照合も遮断する', async () => {
    const sessionId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const stub = coordinator(sessionId);
    const activeReference = reference(sessionId, 'check-barrier-during-revoke');
    await stub.registerMatch(activeReference);

    await expect(
      stub.prepareLogout({
        sessionId,
        accountId,
        sessionVersion: activeReference.sessionVersion,
        sessionDigestHex: 'fa'.repeat(32),
        sessionDigestKeyVersion: 1,
      }),
    ).resolves.toEqual({ state: 'prepared' });

    await expect(stub.checkMatch(activeReference)).resolves.toEqual({
      state: 'invalidated',
      invalidatedVersion: activeReference.sessionVersion + 1,
    });
    await expect(stub.registerMatch(activeReference)).resolves.toEqual({
      state: 'invalidated',
      invalidatedVersion: activeReference.sessionVersion + 1,
    });
  });

  it('logout intentと復旧alarmを先に永続化し、DB ACK後のfan-outで消す', async () => {
    const sessionId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const matchId = `retry-${crypto.randomUUID().slice(0, 8)}`;
    const stub = coordinator(sessionId);
    await stub.registerMatch(reference(sessionId, matchId));
    const intent = {
      sessionId,
      accountId,
      sessionVersion: 1,
      sessionDigestHex: 'ab'.repeat(32),
      sessionDigestKeyVersion: 1,
    };
    await expect(stub.prepareLogout(intent)).resolves.toEqual({ state: 'prepared' });

    const prepared = await runInDurableObject(stub, async (_instance, state) => ({
      values: [...(await state.storage.list()).values()],
      alarm: await state.storage.getAlarm(),
    }));
    expect(prepared.alarm).toEqual(expect.any(Number));
    expect(prepared.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'revoke_pending', accountId }),
      ]),
    );

    await expect(
      stub.confirmLogout({ ...intent, invalidatedVersion: 2 }),
    ).resolves.toEqual({
      state: 'acknowledged',
      invalidatedVersion: 2,
      matchedObjects: 1,
    });

    const snapshot = await runInDurableObject(stub, async (_instance, state) => ({
      values: [...(await state.storage.list()).values()],
      alarm: await state.storage.getAlarm(),
    }));
    expect(snapshot.values).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ phase: expect.any(String) })]),
    );
    expect(snapshot.alarm).toBeNull();
  });

  it('Worker応答喪失後はalarmがDB revokeを再開し、失敗時も自前alarmを残す', async () => {
    const sessionId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const matchId = `alarm-recovery-${crypto.randomUUID().slice(0, 8)}`;
    const stub = coordinator(sessionId);
    const intent = {
      sessionId,
      accountId,
      sessionVersion: 1,
      sessionDigestHex: 'cd'.repeat(32),
      sessionDigestKeyVersion: 1,
    };
    await stub.registerMatch(reference(sessionId, matchId));
    await stub.prepareLogout(intent);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      fetchSpy.mockRejectedValueOnce(new Error('temporary network failure'));
      await runDurableObjectAlarm(stub);
      const retryAlarm = await runInDurableObject(
        stub,
        async (_instance, state) => state.storage.getAlarm(),
      );
      expect(retryAlarm).toEqual(expect.any(Number));
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toBe('http://127.0.0.1:54321/rest/v1/rpc/revoke_app_session');
      expect(JSON.parse(String(init?.body))).toEqual({
        p_token_digest_hex: intent.sessionDigestHex,
        p_token_digest_key_version: 1,
        p_revoke_reason: 'LOGOUT',
      });

      const pending = await runInDurableObject(stub, async (_instance, state) => ({
        values: [...(await state.storage.list()).values()],
        alarm: await state.storage.getAlarm(),
      }));
      expect(pending.values).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            phase: 'revoke_pending',
            retryAttempt: 1,
            lastErrorCode: 'SESSION_STORE_UNAVAILABLE',
          }),
        ]),
      );
      expect(pending.alarm).toEqual(expect.any(Number));
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('OLG-121 SessionCoordinatorDO membership preflight', () => {
  it('同じsession versionとmatchに実参照があればregistered、別versionまたは別matchはmissing', async () => {
    const sessionId = crypto.randomUUID();
    const stub = coordinator(sessionId);
    await stub.registerMatch(reference(sessionId, 'membership-active', 3));

    await expect(
      stub.checkMatchMembership({
        sessionId,
        sessionVersion: 3,
        matchId: 'membership-active',
      }),
    ).resolves.toEqual({ state: 'registered' });
    await expect(
      stub.checkMatchMembership({
        sessionId,
        sessionVersion: 2,
        matchId: 'membership-active',
      }),
    ).resolves.toEqual({ state: 'missing' });
    await expect(
      stub.checkMatchMembership({
        sessionId,
        sessionVersion: 3,
        matchId: 'membership-missing',
      }),
    ).resolves.toEqual({ state: 'missing' });
  });

  it('invalidation floorとlogout workを参照より先に評価し、該当versionをinvalidatedとして返す', async () => {
    const sessionId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const stub = coordinator(sessionId);
    await stub.registerMatch(reference(sessionId, 'membership-blocked'));
    await stub.prepareLogout({
      sessionId,
      accountId,
      sessionVersion: 1,
      sessionDigestHex: 'bb'.repeat(32),
      sessionDigestKeyVersion: 1,
    });
    const before = await runInDurableObject(stub, async (_instance, state) => ({
      entries: [...(await state.storage.list()).entries()],
      alarm: await state.storage.getAlarm(),
    }));

    await expect(
      stub.checkMatchMembership({
        sessionId,
        sessionVersion: 1,
        matchId: 'membership-blocked',
      }),
    ).resolves.toEqual({ state: 'invalidated', invalidatedVersion: 2 });
    await expect(
      runInDurableObject(stub, async (_instance, state) => ({
        entries: [...(await state.storage.list()).entries()],
        alarm: await state.storage.getAlarm(),
      })),
    ).resolves.toEqual(before);

    const floorSessionId = crypto.randomUUID();
    const floorStub = coordinator(floorSessionId);
    await floorStub.invalidateSession({
      sessionId: floorSessionId,
      invalidatedVersion: 5,
    });
    await expect(
      floorStub.checkMatchMembership({
        sessionId: floorSessionId,
        sessionVersion: 4,
        matchId: 'membership-floor-blocked',
      }),
    ).resolves.toEqual({ state: 'invalidated', invalidatedVersion: 5 });
  });

  it('named identityとsession version・safe match IDを検証する', async () => {
    const boundSessionId = crypto.randomUUID();
    const differentSessionId = crypto.randomUUID();
    const result = await runInDurableObject(
      coordinator(boundSessionId),
      async (instance) => {
        const messages: string[] = [];
        for (const input of [
          {
            sessionId: differentSessionId,
            sessionVersion: 1,
            matchId: 'identity-mismatch',
          },
          {
            sessionId: boundSessionId,
            sessionVersion: 0,
            matchId: 'invalid-version',
          },
          {
            sessionId: boundSessionId,
            sessionVersion: 1,
            matchId: '../unsafe',
          },
          {
            sessionId: boundSessionId,
            sessionVersion: 1,
            matchId: 'extra-field',
            extra: true,
          },
        ]) {
          try {
            await (instance as SessionCoordinatorDO).checkMatchMembership(input);
            messages.push('accepted');
          } catch (error) {
            messages.push(error instanceof Error ? error.message : 'unknown');
          }
        }
        return messages;
      },
    );

    expect(result).toEqual([
      'SESSION_COORDINATOR_IDENTITY_INVALID',
      'SESSION_MATCH_MEMBERSHIP_INVALID',
      'SESSION_MATCH_MEMBERSHIP_INVALID',
      'SESSION_MATCH_MEMBERSHIP_INVALID',
    ]);
  });

  it('registered・missing照合の前後でstorageとalarmを一切変更しない', async () => {
    const sessionId = crypto.randomUUID();
    const stub = coordinator(sessionId);
    await stub.registerMatch(reference(sessionId, 'membership-read-only', 4));
    const snapshot = async () => runInDurableObject(stub, async (_instance, state) => ({
      entries: [...(await state.storage.list()).entries()],
      alarm: await state.storage.getAlarm(),
    }));
    const before = await snapshot();

    await stub.checkMatchMembership({
      sessionId,
      sessionVersion: 4,
      matchId: 'membership-read-only',
    });
    await stub.checkMatchMembership({
      sessionId,
      sessionVersion: 4,
      matchId: 'membership-absent',
    });

    await expect(snapshot()).resolves.toEqual(before);
  });
});

describe('OLG-121 server-owned NPC match reservation', () => {
  it('並行・応答喪失再送をsessionごとの同じserver生成match IDとseedへ収束させる', async () => {
    const sessionId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const stub = coordinator(sessionId);
    const input = { sessionId, accountId, sessionVersion: 7 };

    const results = await Promise.all(
      Array.from({ length: 6 }, () => stub.reserveNpcMatch(input)),
    );
    const reservedResults = results.filter(
      (result): result is Extract<typeof result, { state: 'reserved' }> =>
        result.state === 'reserved',
    );
    expect(reservedResults).toHaveLength(6);
    expect(reservedResults.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(reservedResults.map((result) => result.matchId))).toHaveLength(1);
    expect(new Set(reservedResults.map((result) => result.seed))).toHaveLength(1);
    const reservation = reservedResults[0];
    expect(reservation).toMatchObject({ state: 'reserved' });
    if (!reservation || reservation.state !== 'reserved') {
      throw new Error('Expected NPC reservation');
    }
    expect(reservation.matchId).toMatch(
      /^npc-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(reservation.seed).toBeGreaterThanOrEqual(0);
    expect(reservation.seed).toBeLessThanOrEqual(0xffff_ffff);

    await expect(stub.reserveNpcMatch(input)).resolves.toEqual({
      ...reservation,
      created: false,
    });
  });

  it('別account/versionを同じsession予約へ混ぜず、logout workをmatch生成より先に遮断する', async () => {
    const sessionId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const stub = coordinator(sessionId);
    await stub.reserveNpcMatch({ sessionId, accountId, sessionVersion: 1 });

    await expect(stub.reserveNpcMatch({
      sessionId,
      accountId: crypto.randomUUID(),
      sessionVersion: 1,
    })).resolves.toEqual({ state: 'conflict' });
    await expect(stub.reserveNpcMatch({
      sessionId,
      accountId,
      sessionVersion: 2,
    })).resolves.toEqual({ state: 'conflict' });

    await stub.prepareLogout({
      sessionId,
      accountId,
      sessionVersion: 1,
      sessionDigestHex: 'cc'.repeat(32),
      sessionDigestKeyVersion: 1,
    });
    await expect(stub.reserveNpcMatch({
      sessionId,
      accountId,
      sessionVersion: 1,
    })).resolves.toEqual({ state: 'invalidated', invalidatedVersion: 2 });
  });

  it('最後のexact registration解除まで予約を保持し、解除後は次のNPC戦を新規採番する', async () => {
    const sessionId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const sessionVersion = 3;
    const stub = coordinator(sessionId);
    const first = await stub.reserveNpcMatch({ sessionId, accountId, sessionVersion });
    if (first.state !== 'reserved') throw new Error('Expected NPC reservation');
    const older = reference(sessionId, first.matchId, sessionVersion);
    const newer = reference(sessionId, first.matchId, sessionVersion);
    await stub.registerMatch(older);
    await stub.registerMatch(newer);

    await stub.unregisterMatch(older);
    await expect(stub.reserveNpcMatch({ sessionId, accountId, sessionVersion })).resolves.toEqual({
      ...first,
      created: false,
    });

    await stub.unregisterMatch(newer);
    await expect(stub.reserveNpcMatch({ sessionId, accountId, sessionVersion })).resolves.toEqual({
      ...first,
      created: false,
    });
    await expect(stub.releaseNpcMatch({
      sessionId,
      accountId,
      sessionVersion,
      matchId: first.matchId,
      seed: first.seed,
    })).resolves.toEqual({ state: 'released' });
    const next = await stub.reserveNpcMatch({ sessionId, accountId, sessionVersion });
    expect(next).toMatchObject({ state: 'reserved', created: true });
    if (next.state !== 'reserved') throw new Error('Expected next NPC reservation');
    expect(next.matchId).not.toBe(first.matchId);
    await expect(stub.releaseNpcMatch({
      sessionId,
      accountId,
      sessionVersion,
      matchId: first.matchId,
      seed: first.seed,
    })).resolves.toEqual({ state: 'conflict' });
    await expect(stub.reserveNpcMatch({ sessionId, accountId, sessionVersion })).resolves.toEqual({
      ...next,
      created: false,
    });
  });

  it('register前または未知registrationの解除要求は予約のstorage値そのものを変えない', async () => {
    const sessionId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const sessionVersion = 2;
    const stub = coordinator(sessionId);
    const reserved = await stub.reserveNpcMatch({ sessionId, accountId, sessionVersion });
    if (reserved.state !== 'reserved') throw new Error('Expected NPC reservation');

    // reserveNpcMatchの戻り値だけを見ると、unregisterMatchが予約keyへ一切触れなくても
    // 常に同じ結果になり境界を検証できない。予約entry自体をstorageから直接比較する。
    const reservationEntry = async () => {
      const entries = await runInDurableObject(stub, async (_instance, state) => [
        ...(await state.storage.list()).entries(),
      ]);
      return entries.find(
        ([, value]) => typeof value === 'object' && value !== null && 'seed' in value,
      );
    };
    const before = await reservationEntry();
    expect(before).toBeDefined();

    await stub.unregisterMatch(reference(
      sessionId,
      reserved.matchId,
      sessionVersion,
      crypto.randomUUID(),
    ));

    await expect(reservationEntry()).resolves.toEqual(before);
    await expect(stub.reserveNpcMatch({ sessionId, accountId, sessionVersion })).resolves.toEqual({
      ...reserved,
      created: false,
    });
  });

  it('参照が残る間はterminal予約解放を拒否し、exact解除後だけ冪等に解放する', async () => {
    const sessionId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const sessionVersion = 5;
    const stub = coordinator(sessionId);
    const reserved = await stub.reserveNpcMatch({ sessionId, accountId, sessionVersion });
    if (reserved.state !== 'reserved') throw new Error('Expected NPC reservation');
    const activeReference = reference(sessionId, reserved.matchId, sessionVersion);
    await stub.registerMatch(activeReference);
    const release = {
      sessionId,
      accountId,
      sessionVersion,
      matchId: reserved.matchId,
      seed: reserved.seed,
    };

    await expect(stub.releaseNpcMatch(release)).resolves.toEqual({
      state: 'references_remain',
    });
    await stub.unregisterMatch(activeReference);
    await expect(stub.releaseNpcMatch(release)).resolves.toEqual({ state: 'released' });
    await expect(stub.releaseNpcMatch(release)).resolves.toEqual({ state: 'released' });
  });

  it('named identityとexact input schemaをfail closedに検証する', async () => {
    const sessionId = crypto.randomUUID();
    const otherSessionId = crypto.randomUUID();
    const messages = await runInDurableObject(
      coordinator(sessionId),
      async (instance) => {
        const outcomes: string[] = [];
        for (const input of [
          { sessionId: otherSessionId, accountId: crypto.randomUUID(), sessionVersion: 1 },
          { sessionId, accountId: 'not-a-uuid', sessionVersion: 1 },
          { sessionId, accountId: crypto.randomUUID(), sessionVersion: 0 },
          { sessionId, accountId: crypto.randomUUID(), sessionVersion: 1, seed: 1 },
        ]) {
          try {
            await (instance as SessionCoordinatorDO).reserveNpcMatch(input as never);
            outcomes.push('accepted');
          } catch (error) {
            outcomes.push(error instanceof Error ? error.message : 'unknown');
          }
        }
        return outcomes;
      },
    );
    expect(messages).toEqual([
      'SESSION_COORDINATOR_IDENTITY_INVALID',
      'SESSION_NPC_MATCH_RESERVATION_INVALID',
      'SESSION_NPC_MATCH_RESERVATION_INVALID',
      'SESSION_NPC_MATCH_RESERVATION_INVALID',
    ]);
  });
});

describe('OLG-126 NPC match recovery ownership', () => {
  async function releaseNpcMatch(
    stub: CoordinatorStub,
    principal: { sessionId: string; accountId: string; sessionVersion: number },
  ) {
    const reserved = await stub.reserveNpcMatch(principal);
    if (reserved.state !== 'reserved') throw new Error('Expected NPC reservation');
    const release = {
      ...principal,
      matchId: reserved.matchId,
      seed: reserved.seed,
    };
    await expect(stub.releaseNpcMatch(release)).resolves.toEqual({ state: 'released' });
    return release;
  }

  async function storageSnapshot(stub: CoordinatorStub) {
    return runInDurableObject(stub, async (_instance, state) => ({
      entries: [...(await state.storage.list()).entries()],
      alarm: await state.storage.getAlarm(),
    }));
  }

  async function expireRecent(stub: CoordinatorStub) {
    await runInDurableObject(stub, async (_instance, state) => {
      const recent = [...(await state.storage.list()).entries()].find(([, value]) =>
        typeof value === 'object' && value !== null && 'releasedAtEpochMs' in value);
      if (!recent) throw new Error('Expected recent recovery ownership');
      await state.storage.put(recent[0], {
        ...(recent[1] as Record<string, unknown>),
        releasedAtEpochMs: Date.now() - NPC_MATCH_RECOVERY_RETENTION_MS,
      });
    });
  }

  async function hasRecent(stub: CoordinatorStub) {
    return runInDurableObject(stub, async (_instance, state) =>
      [...(await state.storage.list()).values()].some((value) =>
        typeof value === 'object' && value !== null && 'releasedAtEpochMs' in value));
  }

  it('none/activeをseedなしで発見し、ownership readをstorage無変更で行う', async () => {
    const sessionId = crypto.randomUUID();
    const principal = { sessionId, accountId: crypto.randomUUID(), sessionVersion: 4 };
    const stub = coordinator(sessionId);
    await expect(stub.readNpcMatch(principal)).resolves.toEqual({ state: 'none' });
    const reserved = await stub.reserveNpcMatch(principal);
    if (reserved.state !== 'reserved') throw new Error('Expected NPC reservation');
    const before = await storageSnapshot(stub);

    const located = await stub.readNpcMatch(principal);
    expect(located).toEqual({ state: 'located', matchId: reserved.matchId });
    expect(located).not.toHaveProperty('seed');
    await expect(stub.checkNpcMatchRecoveryOwnership({
      ...principal,
      matchId: reserved.matchId,
    })).resolves.toEqual({ state: 'authorized' });
    await expect(stub.checkNpcMatchRecoveryOwnership({
      ...principal,
      matchId: 'another-safe-match',
    })).resolves.toEqual({ state: 'missing' });
    await expect(storageSnapshot(stub)).resolves.toEqual(before);
  });

  it('active reservationをrecentより優先し、壊れたactive storageはrecentへfallbackしない', async () => {
    const sessionId = crypto.randomUUID();
    const principal = { sessionId, accountId: crypto.randomUUID(), sessionVersion: 4 };
    const stub = coordinator(sessionId);
    const recent = await releaseNpcMatch(stub, principal);
    const activeMatchId = `npc-${crypto.randomUUID()}`;
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put('active-npc-match-reservation-v1', {
        accountId: principal.accountId,
        sessionVersion: principal.sessionVersion,
        matchId: activeMatchId,
        seed: 123,
        createdAtEpochMs: Date.now(),
      });
    });

    await expect(stub.readNpcMatch(principal)).resolves.toEqual({
      state: 'located',
      matchId: activeMatchId,
    });
    await expect(stub.checkNpcMatchRecoveryOwnership({
      ...principal,
      matchId: recent.matchId,
    })).resolves.toEqual({ state: 'missing' });
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put('active-npc-match-reservation-v1', {
        accountId: principal.accountId,
        sessionVersion: principal.sessionVersion,
        matchId: activeMatchId,
        seed: 123,
        createdAtEpochMs: Date.now(),
        unexpected: true,
      });
    });
    await expect(stub.readNpcMatch(principal)).resolves.toEqual({ state: 'conflict' });
    await expect(stub.checkNpcMatchRecoveryOwnership({
      ...principal,
      matchId: recent.matchId,
    })).resolves.toEqual({ state: 'conflict' });
  });

  it('releaseをrecentへ移し、応答喪失再送と同じreadへ冪等収束する', async () => {
    const sessionId = crypto.randomUUID();
    const principal = { sessionId, accountId: crypto.randomUUID(), sessionVersion: 6 };
    const stub = coordinator(sessionId);
    const release = await releaseNpcMatch(stub, principal);
    const before = await storageSnapshot(stub);

    await expect(stub.releaseNpcMatch(release)).resolves.toEqual({ state: 'released' });
    await expect(stub.releaseNpcMatch({ ...release, seed: (release.seed + 1) >>> 0 }))
      .resolves.toEqual({ state: 'conflict' });
    await expect(stub.readNpcMatch(principal)).resolves.toEqual({
      state: 'located',
      matchId: release.matchId,
    });
    await expect(stub.checkNpcMatchRecoveryOwnership({
      ...principal,
      matchId: release.matchId,
    })).resolves.toEqual({ state: 'authorized' });
    await expect(storageSnapshot(stub)).resolves.toEqual(before);
    expect(before.entries).toEqual(expect.arrayContaining([
      expect.arrayContaining([
        expect.any(String),
        expect.objectContaining({
          accountId: principal.accountId,
          sessionVersion: principal.sessionVersion,
          matchId: release.matchId,
          seed: release.seed,
          releasedAtEpochMs: expect.any(Number),
        }),
      ]),
    ]));
    expect(before.entries).not.toEqual(expect.arrayContaining([
      expect.arrayContaining([
        expect.any(String),
        expect.objectContaining({ createdAtEpochMs: expect.any(Number) }),
      ]),
    ]));
  });

  it('90日境界のrecentをread/check時にmissingへ倒してlazy deleteする', async () => {
    const firstSessionId = crypto.randomUUID();
    const firstPrincipal = {
      sessionId: firstSessionId,
      accountId: crypto.randomUUID(),
      sessionVersion: 2,
    };
    const firstStub = coordinator(firstSessionId);
    await releaseNpcMatch(firstStub, firstPrincipal);
    await expireRecent(firstStub);
    await expect(firstStub.readNpcMatch(firstPrincipal)).resolves.toEqual({ state: 'none' });
    expect(await hasRecent(firstStub)).toBe(false);

    const secondSessionId = crypto.randomUUID();
    const secondPrincipal = {
      sessionId: secondSessionId,
      accountId: crypto.randomUUID(),
      sessionVersion: 2,
    };
    const secondStub = coordinator(secondSessionId);
    const second = await releaseNpcMatch(secondStub, secondPrincipal);
    await expireRecent(secondStub);
    await expect(secondStub.checkNpcMatchRecoveryOwnership({
      ...secondPrincipal,
      matchId: second.matchId,
    })).resolves.toEqual({ state: 'missing' });
    expect(await hasRecent(secondStub)).toBe(false);
  });

  it('新規activeは同principal/期限切れrecentを削除し、foreign recentは上書きしない', async () => {
    const sessionId = crypto.randomUUID();
    const owner = { sessionId, accountId: crypto.randomUUID(), sessionVersion: 3 };
    const stub = coordinator(sessionId);
    const first = await releaseNpcMatch(stub, owner);
    const second = await stub.reserveNpcMatch(owner);
    expect(second).toMatchObject({ state: 'reserved', created: true });
    if (second.state !== 'reserved') throw new Error('Expected next NPC reservation');
    expect(second.matchId).not.toBe(first.matchId);
    expect(await hasRecent(stub)).toBe(false);

    const foreignSessionId = crypto.randomUUID();
    const foreignOwner = {
      sessionId: foreignSessionId,
      accountId: crypto.randomUUID(),
      sessionVersion: 1,
    };
    const foreignStub = coordinator(foreignSessionId);
    const foreign = await releaseNpcMatch(foreignStub, foreignOwner);
    const intruder = { ...foreignOwner, accountId: crypto.randomUUID() };
    await expect(foreignStub.reserveNpcMatch(intruder)).resolves.toEqual({ state: 'conflict' });
    await expect(foreignStub.readNpcMatch(intruder)).resolves.toEqual({ state: 'conflict' });
    await expect(foreignStub.checkNpcMatchRecoveryOwnership({
      ...intruder,
      matchId: foreign.matchId,
    })).resolves.toEqual({ state: 'conflict' });
    await expect(foreignStub.readNpcMatch(foreignOwner)).resolves.toEqual({
      state: 'located',
      matchId: foreign.matchId,
    });

    const expiredSessionId = crypto.randomUUID();
    const expiredOwner = {
      sessionId: expiredSessionId,
      accountId: crypto.randomUUID(),
      sessionVersion: 1,
    };
    const expiredStub = coordinator(expiredSessionId);
    await releaseNpcMatch(expiredStub, expiredOwner);
    await expireRecent(expiredStub);
    await expect(expiredStub.reserveNpcMatch({
      ...expiredOwner,
      accountId: crypto.randomUUID(),
    })).resolves.toMatchObject({ state: 'reserved', created: true });
  });

  it('blockedVersionを期限判定より先に返し、read時にrecentを変更しない', async () => {
    const sessionId = crypto.randomUUID();
    const principal = { sessionId, accountId: crypto.randomUUID(), sessionVersion: 7 };
    const stub = coordinator(sessionId);
    const released = await releaseNpcMatch(stub, principal);
    await expireRecent(stub);
    await stub.prepareLogout({
      ...principal,
      sessionDigestHex: 'da'.repeat(32),
      sessionDigestKeyVersion: 1,
    });
    const before = await storageSnapshot(stub);

    await expect(stub.readNpcMatch(principal)).resolves.toEqual({
      state: 'invalidated',
      invalidatedVersion: 8,
    });
    await expect(stub.checkNpcMatchRecoveryOwnership({
      ...principal,
      matchId: released.matchId,
    })).resolves.toEqual({ state: 'invalidated', invalidatedVersion: 8 });
    await expect(storageSnapshot(stub)).resolves.toEqual(before);
  });

  it('direct invalidationとlogout confirmationで古いrecentを削除する', async () => {
    const directSessionId = crypto.randomUUID();
    const directPrincipal = {
      sessionId: directSessionId,
      accountId: crypto.randomUUID(),
      sessionVersion: 2,
    };
    const directStub = coordinator(directSessionId);
    await releaseNpcMatch(directStub, directPrincipal);
    await directStub.invalidateSession({ sessionId: directSessionId, invalidatedVersion: 3 });
    expect(await hasRecent(directStub)).toBe(false);

    const logoutSessionId = crypto.randomUUID();
    const logoutPrincipal = {
      sessionId: logoutSessionId,
      accountId: crypto.randomUUID(),
      sessionVersion: 5,
    };
    const logoutStub = coordinator(logoutSessionId);
    await releaseNpcMatch(logoutStub, logoutPrincipal);
    const intent = {
      ...logoutPrincipal,
      sessionDigestHex: 'db'.repeat(32),
      sessionDigestKeyVersion: 1,
    };
    await logoutStub.prepareLogout(intent);
    await logoutStub.confirmLogout({ ...intent, invalidatedVersion: 6 });
    expect(await hasRecent(logoutStub)).toBe(false);
  });

  it('read APIのnamed identity・exact principal・safe match IDをstrictに拒否する', async () => {
    const sessionId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const messages = await runInDurableObject(coordinator(sessionId), async (instance) => {
      const target = instance as SessionCoordinatorDO;
      const calls = [
        () => target.readNpcMatch({
          sessionId: crypto.randomUUID(), accountId, sessionVersion: 1,
        }),
        () => target.readNpcMatch({
          sessionId, accountId, sessionVersion: 1, extra: true,
        } as never),
        () => target.checkNpcMatchRecoveryOwnership({
          sessionId, accountId, sessionVersion: 1, matchId: '../unsafe',
        }),
        () => target.checkNpcMatchRecoveryOwnership({
          sessionId, accountId, sessionVersion: 1, matchId: 'safe', extra: true,
        } as never),
      ];
      const outcomes: string[] = [];
      for (const call of calls) {
        try {
          await call();
          outcomes.push('accepted');
        } catch (error) {
          outcomes.push(error instanceof Error ? error.message : 'unknown');
        }
      }
      return outcomes;
    });
    expect(messages).toEqual([
      'SESSION_COORDINATOR_IDENTITY_INVALID',
      'SESSION_NPC_MATCH_RESERVATION_INVALID',
      'SESSION_NPC_MATCH_RECOVERY_OWNERSHIP_INVALID',
      'SESSION_NPC_MATCH_RECOVERY_OWNERSHIP_INVALID',
    ]);
  });
});
