import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  acquireProcessLock,
  assertPortAvailable,
  combineFailures,
  createLocalWorkerEnvFile,
  createSignalGuard,
  localEndpoints,
  monitorChild,
  parseArgs,
  prepareSupabase,
  probeWebSocket,
  supabaseCliArgs,
  supabaseStartFoundExistingStack,
  supabaseStatusIsExplicitlyStopped,
  verifyWorkerReadiness,
  waitForCriticalCleanup,
  waitForHealth,
  workerCliArgs,
} from './run-local-online.mjs';

describe('run-local-online', () => {
  it('安全な既定値と明示optionを解釈する', () => {
    assert.deepEqual(parseArgs([], {}), {
      smoke: false,
      workerOnly: false,
      help: false,
      port: 8787,
    });
    assert.deepEqual(parseArgs(['--smoke', '--worker-only', '--port', '9001'], {}), {
      smoke: true,
      workerOnly: true,
      help: false,
      port: 9001,
    });
    assert.equal(parseArgs([], { ONLINE_WORKER_PORT: '9123' }).port, 9123);
  });

  it('不明optionと危険なportを拒否する', () => {
    assert.throws(() => parseArgs(['--unknown'], {}), /不明なオプション/);
    assert.throws(() => parseArgs(['--port', '0'], {}), /1〜65535/);
    assert.throws(() => parseArgs(['--port=65536'], {}), /1〜65535/);
    assert.throws(() => parseArgs(['--port'], {}), /1〜65535/);
  });

  it('health/WebSocket endpointを同じloopback portへ固定する', () => {
    assert.deepEqual(localEndpoints(9001), {
      health: 'http://127.0.0.1:9001/health',
      websocket: 'ws://127.0.0.1:9001/matches/local-smoke/ws',
    });
  });

  it('Supabase CLIのworkdirをsupabase/の親project rootへ固定する', () => {
    const args = supabaseCliArgs(['status', '--output', 'json']);
    assert.deepEqual(args.slice(-5), [
      '--workdir',
      '.',
      'status',
      '--output',
      'json',
    ]);
    assert.ok(args[0].endsWith('/node_modules/supabase/dist/supabase.js'));
  });

  it('Worker secretはmode 0600の一時env fileだけへ置き、argvへ出さず削除する', async () => {
    const publishableKey = 'sb_publishable_local-sentinel';
    const secretKey = 'sb_secret_local-sentinel';
    const envFile = await createLocalWorkerEnvFile({
      code: 0,
      stdout: JSON.stringify({
        API_URL: 'http://127.0.0.1:54321',
        PUBLISHABLE_KEY: publishableKey,
        SECRET_KEY: secretKey,
      }),
      stderr: '',
    });
    try {
      const metadata = await stat(envFile.path);
      assert.equal(metadata.mode & 0o777, 0o600);
      const contents = await readFile(envFile.path, 'utf8');
      assert.match(contents, /SESSION_HMAC_KEYS=/);
      assert.match(contents, /SESSION_ENCRYPTION_KEYS=/);
      assert.match(contents, new RegExp(publishableKey));
      assert.match(contents, new RegExp(secretKey));

      const args = workerCliArgs(9001, 'run-1', {
        envFilePath: envFile.path,
        supabaseUrl: 'http://127.0.0.1:54321',
      });
      assert.ok(args.includes(envFile.path));
      assert.doesNotMatch(args.join(' '), new RegExp(publishableKey));
      assert.doesNotMatch(args.join(' '), new RegExp(secretKey));
      assert.ok(args.includes('APP_ORIGIN:http://127.0.0.1:9001'));
    } finally {
      await envFile.dispose();
    }
    await assert.rejects(stat(envFile.path), (error) => error?.code === 'ENOENT');
  });

  it('全checkと起動run IDが揃うまでhealthを再試行する', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      const ready = calls === 2;
      return {
        ok: ready,
        status: ready ? 200 : 503,
        async json() {
          return ready
            ? {
                status: 'ok',
                runId: 'run-1',
                checks: {
                  worker: true,
                  durableObject: true,
                  durableObjectSqlite: true,
                },
              }
            : { status: 'starting', runId: 'stale-run' };
        },
      };
    };

    const health = await waitForHealth('http://local.test/health', {
      fetchImpl,
      timeoutMs: 100,
      intervalMs: 0,
      expectedRunId: 'run-1',
    });
    assert.equal(calls, 2);
    assert.equal(health.status, 'ok');
  });

  it('応答しないhealth requestも全体期限内に中断する', async () => {
    const startedAt = Date.now();
    await assert.rejects(
      waitForHealth('http://local.test/health', {
        fetchImpl: () => new Promise(() => {}),
        timeoutMs: 40,
        attemptTimeoutMs: 10,
        intervalMs: 0,
      }),
      /40ms以内にready/,
    );
    assert.ok(Date.now() - startedAt < 250);
  });

  it('使用中portをWorker起動前に拒否する', async () => {
    const blocker = createServer();
    await new Promise((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen({ host: '127.0.0.1', port: 0 }, resolve);
    });
    const address = blocker.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    try {
      await assert.rejects(assertPortAvailable(address.port), /使用中/);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
    await assertPortAvailable(address.port);
  });

  it('repo単位lockでSupabase二重起動を拒否し、所有者だけが解放する', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bravers-online-lock-'));
    const lockPath = join(directory, 'online.lock');
    try {
      const release = await acquireProcessLock(lockPath);
      await assert.rejects(acquireProcessLock(lockPath), /別のdev:online/);
      await release();
      const releaseAgain = await acquireProcessLock(lockPath);
      await releaseAgain();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('Supabaseをstart前から所有扱いにし、migration確認順を固定する', async () => {
    const calls = [];
    const callOptions = [];
    const state = { owned: false };
    const verifiedStatuses = [];
    await prepareSupabase(state, {
      run: async (args, options) => {
        calls.push(args.join(' '));
        callOptions.push(options);
        return calls.length === 1
          ? { code: 1, stdout: '', stderr: 'supabase start is not running.' }
          : { code: 0, stdout: '', stderr: '' };
      },
      verifyGuestAccount: async (status) => verifiedStatuses.push(status),
    });

    assert.equal(state.owned, true);
    assert.deepEqual(verifiedStatuses, [{ code: 0, stdout: '', stderr: '' }]);
    assert.deepEqual(calls, [
      'status --output json',
      'start',
      'migration up --local',
      'status --output json',
      'migration list --local',
      'test db --local server/test/db',
    ]);
    assert.deepEqual(callOptions[1], { capture: true, tee: false, allowFailure: true });
    assert.deepEqual(callOptions.at(-1), { timeoutMs: 30_000 });
  });

  it('DB受入テスト失敗をWorker起動前に止める', async () => {
    const state = { owned: false };
    const calls = [];

    await assert.rejects(
      prepareSupabase(state, {
        run: async (args) => {
          calls.push(args.join(' '));
          if (args[0] === 'test') throw new Error('pgTAP failed');
          return { code: 0, stdout: '{}', stderr: '' };
        },
      }),
      /DB受入テスト/,
    );

    assert.equal(state.owned, false);
    assert.deepEqual(calls, [
      'status --output json',
      'migration up --local',
      'status --output json',
      'migration list --local',
      'test db --local server/test/db',
    ]);
  });

  it('Supabase start途中の失敗でもcleanup対象の所有状態を残す', async () => {
    const state = { owned: false };
    await assert.rejects(
      prepareSupabase(state, {
        run: async (args) => {
          if (args[0] === 'status') {
            return {
              code: 1,
              stdout: '',
              stderr: 'supabase_db_bravers_duel container is not running: exited',
            };
          }
          throw new Error('partial start');
        },
      }),
      /Docker互換ランタイム/,
    );
    assert.equal(state.owned, true);
  });

  it('pinned Supabase CLIのnot-running出力だけを起動対象にする', () => {
    assert.equal(
      supabaseStatusIsExplicitlyStopped({
        code: 1,
        stdout: '{"_tag":"NoRunningStackError"}',
        stderr: '',
      }),
      true,
    );
    assert.equal(
      supabaseStatusIsExplicitlyStopped({
        code: 1,
        stdout: '',
        stderr: 'No local Supabase stack is running for this project.',
      }),
      true,
    );
    assert.equal(
      supabaseStatusIsExplicitlyStopped({
        code: 1,
        stdout: '',
        stderr: 'supabase_db_bravers_duel container is not running: exited',
      }),
      true,
    );
    assert.equal(
      supabaseStatusIsExplicitlyStopped({
        code: 1,
        stdout: '',
        stderr:
          'failed to inspect container health: Error response from daemon: ' +
          'No such container: supabase_db_bravers_duel',
      }),
      true,
    );
    assert.equal(
      supabaseStatusIsExplicitlyStopped({
        code: 1,
        stdout: '',
        stderr: 'supabase_db_bravers_duel container is not ready: unhealthy',
      }),
      false,
    );
  });

  it('status後に別processがstartしたraceは借用扱いにする', async () => {
    assert.equal(
      supabaseStartFoundExistingStack({
        code: 0,
        stdout: 'supabase start is already running.',
        stderr: '',
      }),
      true,
    );
    const state = { owned: false };
    let call = 0;
    await prepareSupabase(state, {
      run: async () => {
        call += 1;
        if (call === 1) {
          return { code: 1, stdout: '', stderr: 'supabase start is not running.' };
        }
        if (call === 2) {
          return { code: 0, stdout: 'supabase start is already running.', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(state.owned, false);
  });

  it('曖昧なSupabase status失敗では借用stackを所有扱いしない', async () => {
    const state = { owned: false };
    const calls = [];
    const secretSentinel = 'sb_secret_must-not-appear';
    await assert.rejects(
      prepareSupabase(state, {
        run: async (args) => {
          calls.push(args.join(' '));
          return {
            code: 1,
            stdout: JSON.stringify({ API_URL: 'http://127.0.0.1:54321', SECRET_KEY: secretSentinel }),
            stderr: 'container is unhealthy',
          };
        },
      }),
      (error) => {
        assert.match(error.message, /状態を安全に確認できません/);
        assert.doesNotMatch(error.message, new RegExp(secretSentinel));
        assert.doesNotMatch(error.cause?.message ?? '', new RegExp(secretSentinel));
        return true;
      },
    );
    assert.equal(state.owned, false);
    assert.deepEqual(calls, ['status --output json']);
  });

  it('起動工程中のSIGTERMを捕捉してfinallyへ戻せる', async () => {
    const target = new EventEmitter();
    const guard = createSignalGuard(target);
    const waiting = guard.wait(new Promise(() => {}));
    target.emit('SIGTERM');
    await assert.rejects(waiting, (error) => error.signal === 'SIGTERM');
    assert.equal(guard.signal.aborted, true);
    guard.dispose();
  });

  it('cleanup完了までは重複signalを捕捉し、最初の中断理由を保つ', async () => {
    const target = new EventEmitter();
    const guard = createSignalGuard(target);
    const waiting = guard.wait(new Promise(() => {}));

    target.emit('SIGINT');
    target.emit('SIGINT');
    target.emit('SIGTERM');

    await assert.rejects(waiting, (error) => error.signal === 'SIGINT');
    assert.equal(target.listenerCount('SIGINT'), 1);
    assert.equal(target.listenerCount('SIGTERM'), 1);
    guard.dispose();
    assert.equal(target.listenerCount('SIGINT'), 0);
    assert.equal(target.listenerCount('SIGTERM'), 0);
  });

  it('guest検証中のSIGINTはその後始末完了までSupabase準備を返さない', async () => {
    const target = new EventEmitter();
    const guard = createSignalGuard(target);
    let markVerificationStarted;
    let releaseVerification;
    const verificationStarted = new Promise((resolve) => {
      markVerificationStarted = resolve;
    });
    const verificationCleanup = new Promise((resolve) => {
      releaseVerification = resolve;
    });
    let settled = false;

    const preparing = prepareSupabase(
      { owned: false },
      {
        run: async () => ({ code: 0, stdout: '{}', stderr: '' }),
        wait: (operation) => guard.wait(operation),
        verifyGuestAccount: async () => {
          markVerificationStarted();
          await verificationCleanup;
        },
      },
    );
    const observed = preparing.then(
      () => {
        settled = true;
        return null;
      },
      (error) => {
        settled = true;
        return error;
      },
    );

    try {
      await verificationStarted;
      target.emit('SIGINT');
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(settled, false);

      releaseVerification();
      const error = await observed;
      assert.equal(error?.signal, 'SIGINT');
      assert.equal(settled, true);
    } finally {
      releaseVerification();
      guard.dispose();
    }
  });

  it('中断後のcritical cleanup失敗は両方の理由を保持する', async () => {
    const target = new EventEmitter();
    const guard = createSignalGuard(target);
    let rejectCleanup;
    const operation = new Promise((_, reject) => {
      rejectCleanup = reject;
    });
    const waiting = waitForCriticalCleanup(operation, (candidate) => guard.wait(candidate));

    target.emit('SIGTERM');
    rejectCleanup(new Error('cleanup failed'));
    await assert.rejects(waiting, (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors[0].signal, 'SIGTERM');
      assert.match(error.errors[1].message, /cleanup failed/);
      return true;
    });
    guard.dispose();
  });

  it('Workerのready前exitを疎通成功として扱わない', async () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    const monitor = monitorChild(child);
    child.emit('exit', 98, null);
    await assert.rejects(monitor.failure, /予期せず終了/);
    monitor.dispose();
  });

  it('SIGINTとWorker exit 0が競合しても通常終了を優先する', async () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    const controller = new AbortController();
    const monitor = monitorChild(child, 'Worker', { signal: controller.signal });
    child.emit('exit', 0, null);
    const interruption = new Error('SIGINT');
    controller.abort(interruption);
    await assert.rejects(monitor.failure, (error) => error === interruption);
    monitor.dispose();
  });

  it('Workerのready前exitで敗者のhealth待機も即時abortする', async () => {
    const outer = new AbortController();
    let rejectWorker;
    const workerFailure = new Promise((_, reject) => {
      rejectWorker = reject;
    });
    let readinessAborted = false;
    const waiting = verifyWorkerReadiness({
      endpoints: localEndpoints(9001),
      runId: 'run-abort',
      workerFailure,
      signal: outer.signal,
      waitForHealthImpl: (_url, { signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              readinessAborted = true;
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    });
    rejectWorker(new Error('worker exited'));
    await assert.rejects(waiting, /worker exited/);
    assert.equal(readinessAborted, true);
  });

  it('WebSocket probeを一度だけ完了・closeする', async () => {
    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 3;
      static last = null;

      constructor() {
        this.readyState = FakeWebSocket.CONNECTING;
        this.closeCalls = 0;
        FakeWebSocket.last = this;
        queueMicrotask(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.onopen?.();
        });
      }

      send(message) {
        const nonce = message.slice('probe:'.length);
        this.onmessage?.({ data: `probe_ack:local-smoke:${nonce}` });
        this.onclose?.();
      }

      close() {
        this.closeCalls += 1;
        this.readyState = FakeWebSocket.CLOSED;
      }
    }

    const result = await probeWebSocket('ws://local.test', {
      nonce: 'nonce-1',
      WebSocketImpl: FakeWebSocket,
      timeoutMs: 50,
    });
    assert.equal(result, 'probe_ack:local-smoke:nonce-1');
    assert.equal(FakeWebSocket.last.closeCalls, 1);
  });

  it('CONNECTING中のWebSocket timeoutも一度だけcloseする', async () => {
    class HangingWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 3;
      static last = null;

      constructor() {
        this.readyState = HangingWebSocket.CONNECTING;
        this.closeCalls = 0;
        HangingWebSocket.last = this;
      }

      close() {
        this.closeCalls += 1;
        this.readyState = HangingWebSocket.CLOSED;
      }
    }

    await assert.rejects(
      probeWebSocket('ws://local.test', {
        nonce: 'nonce-timeout',
        WebSocketImpl: HangingWebSocket,
        timeoutMs: 5,
      }),
      /timeout/,
    );
    assert.equal(HangingWebSocket.last.closeCalls, 1);
  });

  it('primary errorとcleanup errorを両方保持する', () => {
    const primary = new Error('primary');
    const cleanup = new Error('cleanup');
    const combined = combineFailures(primary, [cleanup]);
    assert.ok(combined instanceof AggregateError);
    assert.deepEqual(combined.errors, [primary, cleanup]);
    assert.equal(combined.cause, primary);
    assert.equal(combineFailures(primary, []), primary);
    assert.equal(combineFailures(null, []), null);
  });
});
