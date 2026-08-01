import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  localAuthConfigFromStatus,
  verifyLocalGuestAccount,
} from './verify-local-guest-account.mjs';

const ACCOUNT_ID = '11111111-2222-4333-8444-555555555555';
const PUBLISHABLE_KEY = 'sb_publishable_local-test';
const SECRET_KEY = 'sb_secret_local-test';
const STATUS = {
  code: 0,
  stdout: JSON.stringify({
    API_URL: 'http://127.0.0.1:54321',
    PUBLISHABLE_KEY,
    SECRET_KEY,
  }),
  stderr: '',
};

function query(result) {
  return {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    async maybeSingle() {
      return result();
    },
  };
}

function clients({
  serviceRows = [{ account_id: ACCOUNT_ID }, null],
  deleteError = null,
  directError = { code: '42501' },
} = {}) {
  let serviceRead = 0;
  const guestClient = {
    auth: {
      async signInAnonymously() {
        return {
          data: {
            user: { id: ACCOUNT_ID, is_anonymous: true },
            session: {
              user: { id: ACCOUNT_ID },
              access_token: 'access-token-sentinel',
              refresh_token: 'refresh-token-sentinel',
            },
          },
          error: null,
        };
      },
    },
    from() {
      return query(() => ({ data: null, error: directError }));
    },
  };
  const adminClient = {
    auth: {
      admin: {
        async deleteUser() {
          return { data: null, error: deleteError };
        },
      },
    },
    from() {
      return query(() => ({ data: serviceRows[serviceRead++], error: null }));
    },
  };
  const createClientImpl = (_url, key) => (key === PUBLISHABLE_KEY ? guestClient : adminClient);
  return { createClientImpl, guestClient, adminClient };
}

describe('OLG-111 local guest account live smoke', () => {
  it('loopback URLと新形式keyだけをstatusから受理する', () => {
    assert.deepEqual(localAuthConfigFromStatus(STATUS), {
      apiUrl: 'http://127.0.0.1:54321',
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
    });
    assert.throws(
      () =>
        localAuthConfigFromStatus({
          ...STATUS,
          stdout: JSON.stringify({
            API_URL: 'https://project.supabase.co',
            PUBLISHABLE_KEY,
            SECRET_KEY,
          }),
        }),
      /安全な形式/,
    );
    assert.throws(
      () => localAuthConfigFromStatus({ ...STATUS, stdout: '{not json' }),
      /status JSON/,
    );
  });

  it('匿名signup・直接read拒否・同一account・hard delete cascadeを完走する', async () => {
    const fixture = clients();
    const result = await verifyLocalGuestAccount(STATUS, fixture);
    assert.deepEqual(result, { accountId: ACCOUNT_ID });
  });

  it('account root欠損でも作成済みAuth userを後始末し、秘密を例外へ出さない', async () => {
    let deleteCalls = 0;
    const fixture = clients({ serviceRows: [null, null] });
    const originalDelete = fixture.adminClient.auth.admin.deleteUser;
    fixture.adminClient.auth.admin.deleteUser = async (...args) => {
      deleteCalls += 1;
      return originalDelete(...args);
    };

    await assert.rejects(
      verifyLocalGuestAccount(STATUS, fixture),
      (error) => {
        assert.match(String(error), /同一UUID/);
        assert.doesNotMatch(String(error), /access-token-sentinel/);
        assert.doesNotMatch(String(error), new RegExp(PUBLISHABLE_KEY));
        assert.doesNotMatch(String(error), new RegExp(SECRET_KEY));
        return true;
      },
    );
    assert.equal(deleteCalls, 1);
  });

  it('直接readのnetwork失敗を権限拒否として誤合格しない', async () => {
    const fixture = clients({ directError: { code: 'PGRST000' }, serviceRows: [null] });
    await assert.rejects(
      verifyLocalGuestAccount(STATUS, fixture),
      /直接read拒否を確認できません/,
    );
  });

  it('cleanup失敗を成功扱いにしない', async () => {
    const fixture = clients({ deleteError: { message: 'raw secret failure' } });
    await assert.rejects(
      verifyLocalGuestAccount(STATUS, fixture),
      /test Auth userを削除できません/,
    );
  });

  it('SDK client構築例外からsecretとraw messageを外す', async () => {
    await assert.rejects(
      verifyLocalGuestAccount(STATUS, {
        createClientImpl: () => {
          throw new Error(`raw ${SECRET_KEY}`);
        },
      }),
      (error) => {
        assert.match(String(error), /検証requestに失敗/);
        assert.doesNotMatch(String(error), new RegExp(SECRET_KEY));
        return true;
      },
    );
  });

  it('SDK mockがsignalを無視してもrequest deadlineで停止する', async () => {
    const fixture = clients();
    fixture.guestClient.auth.signInAnonymously = async () => new Promise(() => {});
    const startedAt = Date.now();

    await assert.rejects(
      verifyLocalGuestAccount(STATUS, { ...fixture, requestTimeoutMs: 5 }),
      /anonymous signup timeout/,
    );
    assert.ok(Date.now() - startedAt < 250);
  });

  it('Auth responseのbodyが止まっても同じrequest deadlineで停止する', async () => {
    const response = new Response(new ReadableStream({ start() {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const startedAt = Date.now();

    await assert.rejects(
      verifyLocalGuestAccount(STATUS, {
        fetchImpl: async () => response,
        requestTimeoutMs: 5,
      }),
      /(?:request timeout|匿名signup応答が不正)/,
    );
    assert.ok(Date.now() - startedAt < 250);
  });
});
