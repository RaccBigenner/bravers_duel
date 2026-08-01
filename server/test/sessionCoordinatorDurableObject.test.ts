import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_SESSION_MATCH_REGISTRATIONS_PER_MATCH,
  MAX_SESSION_MATCH_REFERENCES,
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
