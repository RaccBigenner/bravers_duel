#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyLocalGuestAccount } from './verify-local-guest-account.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PORT = 8787;
const LOCAL_STACK_LOCK = join(ROOT, '.wrangler', 'online-local.lock');
const supabaseScript = join(ROOT, 'node_modules', 'supabase', 'dist', 'supabase.js');
const wranglerScript = join(ROOT, 'server', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const ownProcessGroup = new WeakSet();

const HELP = `BRAVER'S DUEL ローカルオンライン基盤

Usage:
  npm run dev:online
  npm run smoke:online
  npm run smoke:online -- --worker-only

Options:
  --smoke         起動・migration・health・WebSocket疎通後に終了する
  --worker-only   Docker不要のWorker/MatchDO診断（Supabaseを省略）
  --port <port>   Workerのlisten port（既定: 8787）
  --help          この説明を表示する

通常起動にはDocker互換ランタイムが必要です。外部Cloudflare/Supabase projectには接続しません。`;

export function parseArgs(argv, env = process.env) {
  const result = {
    smoke: false,
    workerOnly: false,
    help: false,
    port: Number(env.ONLINE_WORKER_PORT ?? DEFAULT_PORT),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--smoke') result.smoke = true;
    else if (arg === '--worker-only') result.workerOnly = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--port') result.port = Number(argv[++index]);
    else if (arg.startsWith('--port=')) result.port = Number(arg.slice('--port='.length));
    else throw new Error(`不明なオプションです: ${arg}`);
  }

  if (!Number.isInteger(result.port) || result.port < 1 || result.port > 65535) {
    throw new Error(`portは1〜65535の整数で指定してください: ${result.port}`);
  }
  return result;
}

export function localEndpoints(port) {
  return {
    health: `http://127.0.0.1:${port}/health`,
    websocket: `ws://127.0.0.1:${port}/matches/local-smoke/ws`,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanCliOutput(value) {
  return String(value).replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

function structuredCliErrorCode(output) {
  try {
    const parsed = JSON.parse(output.trim());
    return parsed?._tag ?? parsed?.error?.code ?? null;
  } catch {
    return null;
  }
}

export function supabaseStatusIsExplicitlyStopped(result) {
  if (result.code === 0) return false;
  const output = cleanCliOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  if (structuredCliErrorCode(output) === 'NoRunningStackError') return true;
  return (
    /No local Supabase stack is running for this project\./i.test(output) ||
    /supabase start is not running\./i.test(output) ||
    /supabase_db_[A-Za-z0-9_-]+ container is not running:/i.test(output) ||
    /No such (?:container|object)[^\n]*supabase_db_[A-Za-z0-9_-]+/i.test(output) ||
    /supabase_db_[A-Za-z0-9_-]+[^\n]*(?:no such container|no such object)/i.test(output)
  );
}

export function supabaseStartFoundExistingStack(result) {
  const output = cleanCliOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  return (
    structuredCliErrorCode(output) === 'StackAlreadyRunningError' ||
    /supabase start is already running\./i.test(output) ||
    /A (?:local )?Supabase stack(?: "[^"]+")? is already running/i.test(output)
  );
}

function isMissingProcess(error) {
  return error && typeof error === 'object' && error.code === 'ESRCH';
}

function signalChild(child, signal) {
  if (!child.pid) return;
  try {
    if (ownProcessGroup.has(child)) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (!isMissingProcess(error)) throw error;
  }
}

function waitForChildExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const onExit = () => resolve();
    child.once('exit', onExit);
    if (child.exitCode !== null || child.signalCode !== null) {
      child.off('exit', onExit);
      resolve();
    }
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = waitForChildExit(child);
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    const [code] = await once(killer, 'exit');
    if (code !== 0 && child.exitCode === null && child.signalCode === null) {
      throw new Error(`process treeを停止できませんでした（pid ${child.pid}, taskkill ${code}）`);
    }
    await Promise.race([exited, delay(5_000)]);
    return;
  }
  signalChild(child, 'SIGTERM');
  const completed = await Promise.race([exited.then(() => true), delay(5_000).then(() => false)]);
  if (!completed && child.exitCode === null && child.signalCode === null) {
    signalChild(child, 'SIGKILL');
    await waitForChildExit(child);
  }
}

function createProcessRegistry() {
  const children = new Set();

  return {
    spawn(command, args, options) {
      const detached = process.platform !== 'win32' && (options.detached ?? true);
      const child = spawn(command, args, {
        ...options,
        detached,
      });
      if (detached && process.platform !== 'win32') ownProcessGroup.add(child);
      children.add(child);
      const forget = () => children.delete(child);
      child.once('exit', forget);
      child.once('error', forget);
      return child;
    },
    async stopAll() {
      const results = await Promise.allSettled([...children].reverse().map(stopChild));
      const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
      if (errors.length) throw new AggregateError(errors, '子プロセスの停止に失敗しました');
    },
  };
}

function runCommand(
  registry,
  command,
  args,
  { capture = false, tee = false, allowFailure = false, timeoutMs } = {},
) {
  return new Promise((resolve, reject) => {
    const child = registry.spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timingOut = false;
    let timer = null;

    if (capture) {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (tee) process.stdout.write(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
        if (tee) process.stderr.write(chunk);
      });
    }

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    child.once('error', (error) => finish(error));
    child.once('exit', (code, signal) => {
      if (timingOut) return;
      const result = { code: code ?? 1, signal, stdout, stderr };
      if (code === 0 || allowFailure) finish(null, result);
      else finish(new Error(`${command} ${args.join(' ')} が終了コード ${code ?? signal} で失敗しました`));
    });
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        if (settled) return;
        timingOut = true;
        stopChild(child).then(
          () => finish(new Error(`${command} が${timeoutMs}msでtimeoutしました`)),
          (error) =>
            finish(
              new AggregateError(
                [new Error(`${command} が${timeoutMs}msでtimeoutしました`), error],
                'timeoutしたprocessの停止にも失敗しました',
              ),
            ),
        );
      }, timeoutMs);
    }
  });
}

function runSupabase(registry, args, options) {
  return runCommand(
    registry,
    process.execPath,
    supabaseCliArgs(args),
    options,
  );
}

export function supabaseCliArgs(args) {
  // --workdirはconfig.tomlのあるsupabase/ではなく、その親project rootを指す。
  return [supabaseScript, '--workdir', '.', ...args];
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isMissingProcess(error);
  }
}

export async function acquireProcessLock(lockPath = LOCAL_STACK_LOCK) {
  await mkdir(dirname(lockPath), { recursive: true });
  const token = crypto.randomUUID();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
      await handle.close();
      return async () => {
        try {
          const current = JSON.parse(await readFile(lockPath, 'utf8'));
          if (current.token === token) await unlink(lockPath);
        } catch (error) {
          if (!(error && typeof error === 'object' && error.code === 'ENOENT')) throw error;
        }
      };
    } catch (error) {
      if (!(error && typeof error === 'object' && error.code === 'EEXIST')) throw error;
      let owner;
      try {
        owner = JSON.parse(await readFile(lockPath, 'utf8'));
      } catch {
        throw new Error(`ローカルstack lockを読めません。内容を確認してください: ${lockPath}`);
      }
      if (processIsAlive(owner.pid)) {
        throw new Error(`別のdev:onlineが実行中です（pid ${owner.pid}）`);
      }
      await unlink(lockPath);
    }
  }
  throw new Error(`ローカルstack lockを取得できません: ${lockPath}`);
}

export function assertPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', (error) => {
      if (error && typeof error === 'object' && error.code === 'EADDRINUSE') {
        reject(new Error(`${host}:${port}は使用中です。既存Workerを停止するか別portを指定してください。`));
      } else {
        reject(error);
      }
    });
    probe.listen({ host, port, exclusive: true }, () => {
      probe.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });
}

export class InterruptedError extends Error {
  constructor(signal) {
    super(`${signal}を受け取ったため終了します`);
    this.name = 'InterruptedError';
    this.signal = signal;
  }
}

export function createSignalGuard(target = process) {
  const controller = new AbortController();
  let rejectSignal;
  const promise = new Promise((_, reject) => {
    rejectSignal = reject;
  });
  promise.catch(() => {});

  const interrupt = (signal) => {
    if (controller.signal.aborted) return;
    const error = new InterruptedError(signal);
    controller.abort(error);
    rejectSignal(error);
  };
  const onSigint = () => interrupt('SIGINT');
  const onSigterm = () => interrupt('SIGTERM');
  const onSighup = () => interrupt('SIGHUP');
  // npm と TTY から同じ signal が重複配送されることがある。cleanup 中も
  // listener を維持し、最初の signal だけを採用して後続は interrupt 側で無視する。
  target.on('SIGINT', onSigint);
  target.on('SIGTERM', onSigterm);
  if (process.platform !== 'win32') target.on('SIGHUP', onSighup);

  return {
    signal: controller.signal,
    promise,
    wait(operation) {
      return Promise.race([operation, promise]);
    },
    dispose() {
      target.off('SIGINT', onSigint);
      target.off('SIGTERM', onSigterm);
      if (process.platform !== 'win32') target.off('SIGHUP', onSighup);
    },
  };
}

/**
 * 中断を即座に記録しつつ、期限付きの検証処理が自前の後始末を終えるまで待つ。
 * guest smokeを置き去りにしたまま外側のfinallyでSupabaseを停止しないための境界。
 */
export async function waitForCriticalCleanup(operation, wait) {
  try {
    return await wait(operation);
  } catch (error) {
    if (!(error instanceof InterruptedError)) throw error;
    try {
      await operation;
    } catch (settleError) {
      throw new AggregateError(
        [error, settleError],
        '中断後のゲストaccount後始末に失敗しました',
        { cause: error },
      );
    }
    throw error;
  }
}

export async function prepareSupabase(
  state,
  { run, wait = (operation) => operation, verifyGuestAccount } = {},
) {
  let phase = 'status';
  try {
    const before = await wait(run(['status', '--output', 'json'], { capture: true, allowFailure: true }));
    const alreadyRunning = before.code === 0;
    const explicitlyStopped = supabaseStatusIsExplicitlyStopped(before);
    if (!alreadyRunning && !explicitlyStopped) {
      // statusは部分的にcredential付きJSONを返してから失敗し得る。raw出力を例外へ入れない。
      throw new Error(`Supabase statusを安全に判定できません（exit ${before.code}）`);
    }

    if (!alreadyRunning) {
      phase = 'start';
      state.owned = true;
      console.log('▶ Supabase local stackを起動します');
      // CLIはloopback用secret keyも起動結果へ含めるため、consoleへteeしない。
      const started = await wait(run(['start'], { capture: true, tee: false, allowFailure: true }));
      if (supabaseStartFoundExistingStack(started)) {
        state.owned = false;
        console.log('✓ 競合して起動した既存Supabase local stackを借用します');
      } else if (started.code !== 0) {
        throw new Error(`supabase startが終了コード${started.code}で失敗しました`);
      }
    } else {
      console.log('✓ 起動済みのSupabase local stackを使用します');
    }

    phase = 'migration';
    console.log('▶ 未適用のlocal migrationを適用します');
    await wait(run(['migration', 'up', '--local']));
    const readyStatus = await wait(run(['status', '--output', 'json'], { capture: true }));
    await wait(run(['migration', 'list', '--local']));
    console.log('▶ local DBのpgTAP受入テストを実行します');
    await wait(run(['test', 'db', '--local', 'server/test/db'], { timeoutMs: 30_000 }));
    if (verifyGuestAccount) {
      phase = 'guest-auth';
      console.log('▶ local Authの匿名account作成と削除cascadeを検証します');
      const verification = Promise.resolve().then(() => verifyGuestAccount(readyStatus));
      await waitForCriticalCleanup(verification, wait);
    }
  } catch (error) {
    if (error instanceof InterruptedError) throw error;
    const message =
      phase === 'guest-auth'
        ? 'Supabase local Authのゲストaccount受入テストに失敗しました。'
        : phase === 'migration'
          ? 'Supabase local migration・status・DB受入テストのいずれかに失敗しました。直前のCLI出力を確認してください。'
          : phase === 'status'
            ? 'Supabase local stackの状態を安全に確認できません。Docker互換ランタイムと既存stackを確認してください。既存stackには触れていません。'
            : 'Supabase local stackを起動できません。Docker互換ランタイムを起動して再実行してください。';
    throw new Error(
      `${message} Workerだけの診断は \`npm run smoke:online -- --worker-only\` で実行できます。`,
      { cause: error },
    );
  }
}

function startWorker(port, runId, registry, { detached }) {
  console.log(`▶ Worker/MatchDOを127.0.0.1:${port}で起動します`);
  return registry.spawn(
    process.execPath,
    [
      wranglerScript,
      'dev',
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--var',
      'APP_ENV:local',
      '--var',
      `OLG102_RUN_ID:${runId}`,
    ],
    {
      cwd: join(ROOT, 'server'),
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
      detached,
    },
  );
}

export function monitorChild(child, label = 'Worker', { signal } = {}) {
  let active = true;
  let exitTimer = null;
  let rejectFailure;
  const failure = new Promise((_, reject) => {
    rejectFailure = reject;
  });
  failure.catch(() => {});

  const fail = (error) => {
    if (!active) return;
    active = false;
    rejectFailure(error);
  };
  const onError = (error) => fail(new Error(`${label} processを起動できません`, { cause: error }));
  const onExit = (code, exitSignal) => {
    exitTimer = setTimeout(() => {
      if (signal?.aborted) fail(signal.reason);
      else fail(new Error(`${label}が予期せず終了しました（${code ?? exitSignal ?? 'unknown'}）`));
    }, 10);
  };
  child.once('error', onError);
  child.once('exit', onExit);

  return {
    failure,
    dispose() {
      active = false;
      if (exitTimer) clearTimeout(exitTimer);
      child.off('error', onError);
      child.off('exit', onExit);
    },
  };
}

function raceWithSignal(operation, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, signal.reason ?? new Error('処理を中断しました'));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(operation).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

export async function waitForHealth(
  url,
  {
    fetchImpl = fetch,
    timeoutMs = 30_000,
    intervalMs = 250,
    attemptTimeoutMs = 5_000,
    expectedRunId,
    signal,
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason;
    const remaining = Math.max(1, deadline - Date.now());
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error('health requestがtimeoutしました')),
      Math.min(attemptTimeoutMs, remaining),
    );
    const onOuterAbort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', onOuterAbort, { once: true });

    try {
      const response = await raceWithSignal(
        Promise.resolve().then(() =>
          fetchImpl(url, {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          }),
        ),
        controller.signal,
      );
      const body = await raceWithSignal(response.json(), controller.signal);
      const correctRun = expectedRunId === undefined || body.runId === expectedRunId;
      if (
        response.ok &&
        body.status === 'ok' &&
        body.checks?.worker === true &&
        body.checks?.durableObject === true &&
        body.checks?.durableObjectSqlite === true &&
        correctRun
      ) {
        return body;
      }
      lastError = new Error(
        correctRun
          ? `health responseが未準備です（status ${response.status}）`
          : '起動したWorkerとhealth応答のrun IDが一致しません',
      );
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      lastError = error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onOuterAbort);
    }

    const waitMs = Math.min(intervalMs, Math.max(0, deadline - Date.now()));
    if (waitMs > 0) {
      if (signal) await raceWithSignal(delay(waitMs), signal);
      else await delay(waitMs);
    }
  }

  throw new Error(`Worker healthが${timeoutMs}ms以内にreadyになりませんでした`, {
    cause: lastError,
  });
}

export function probeWebSocket(
  url,
  {
    nonce = crypto.randomUUID(),
    WebSocketImpl = WebSocket,
    timeoutMs = 10_000,
    signal,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const expected = `probe_ack:local-smoke:${nonce}`;
    const socket = new WebSocketImpl(url);
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (
        socket.readyState === WebSocketImpl.CONNECTING ||
        socket.readyState === WebSocketImpl.OPEN
      ) {
        try {
          socket.close(1000, 'probe-complete');
        } catch {
          // 接続確立と中断が競合した場合も、元の結果を優先する。
        }
      }
      if (error) reject(error);
      else resolve(value);
    };
    const onAbort = () => finish(signal.reason ?? new Error('WebSocket probeを中断しました'));
    const timer = setTimeout(
      () => finish(new Error(`WebSocket probeが${timeoutMs}msでtimeoutしました`)),
      timeoutMs,
    );

    if (signal?.aborted) {
      finish(signal.reason);
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.onopen = () => socket.send(`probe:${nonce}`);
    socket.onmessage = (event) => {
      const actual = String(event.data);
      if (actual !== expected) finish(new Error(`WebSocket応答が不正です: ${actual}`));
      else finish(null, actual);
    };
    socket.onerror = () => finish(new Error('WebSocket接続に失敗しました'));
    socket.onclose = () => finish(new Error('WebSocket応答前に切断されました'));
  });
}

export async function verifyWorkerReadiness(
  {
    endpoints,
    runId,
    workerFailure,
    signal,
    waitForHealthImpl = waitForHealth,
    probeWebSocketImpl = probeWebSocket,
  },
) {
  const controller = new AbortController();
  const abort = (reason) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const onOuterAbort = () => abort(signal.reason);
  if (signal.aborted) abort(signal.reason);
  else signal.addEventListener('abort', onOuterAbort, { once: true });

  const monitoredFailure = workerFailure.catch((error) => {
    abort(error);
    throw error;
  });
  const verification = (async () => {
    await waitForHealthImpl(endpoints.health, {
      expectedRunId: runId,
      signal: controller.signal,
    });
    return probeWebSocketImpl(endpoints.websocket, { signal: controller.signal });
  })();

  try {
    return await Promise.race([
      raceWithSignal(verification, controller.signal),
      monitoredFailure,
    ]);
  } finally {
    signal.removeEventListener('abort', onOuterAbort);
    abort(new Error('Worker readiness確認を終了しました'));
  }
}

export function combineFailures(primaryError, cleanupErrors) {
  if (primaryError && cleanupErrors.length > 0) {
    return new AggregateError(
      [primaryError, ...cleanupErrors],
      `${primaryError.message}。後始末にも失敗しました`,
      { cause: primaryError },
    );
  }
  if (primaryError) return primaryError;
  if (cleanupErrors.length > 0) {
    return new AggregateError(cleanupErrors, 'ローカルオンライン基盤の後始末に失敗しました');
  }
  return null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }

  const registry = createProcessRegistry();
  const interrupt = createSignalGuard();
  const supabase = { owned: false };
  let lockPromise = null;
  let releaseLock = null;
  let workerMonitor = null;
  let primaryError = null;
  const cleanupErrors = [];

  try {
    if (options.workerOnly) {
      console.log('⚠ Supabaseを省略したWorker専用診断です');
    } else {
      lockPromise = acquireProcessLock();
      releaseLock = await interrupt.wait(lockPromise);
      await prepareSupabase(supabase, {
        run: (args, runOptions) => runSupabase(registry, args, runOptions),
        wait: (operation) => interrupt.wait(operation),
        ...(options.smoke ? { verifyGuestAccount: verifyLocalGuestAccount } : {}),
      });
    }

    await interrupt.wait(assertPortAvailable(options.port));
    const runId = crypto.randomUUID();
    // 常駐devはnpm/TTYと同じprocess groupに置き、親が強制終了してもCtrl+Cで孤児化させない。
    // 自動smokeは独立groupに置き、正常終了時に子孫をまとめて停止する。
    const worker = startWorker(options.port, runId, registry, { detached: options.smoke });
    workerMonitor = monitorChild(worker, 'Worker', { signal: interrupt.signal });
    const endpoints = localEndpoints(options.port);

    await verifyWorkerReadiness({
      endpoints,
      runId,
      workerFailure: workerMonitor.failure,
      signal: interrupt.signal,
    });
    console.log(`✓ health: ${endpoints.health}`);
    console.log('✓ WebSocket: probe応答と起動run IDが一致');

    if (!options.smoke) {
      console.log('✓ ローカルオンライン基盤がreadyです。終了は Ctrl+C');
      await Promise.race([workerMonitor.failure, interrupt.promise]);
    }
  } catch (error) {
    primaryError = error;
  } finally {
    workerMonitor?.dispose();
    try {
      await registry.stopAll();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (supabase.owned) {
      console.log('▶ このコマンドが起動を試みたSupabase local stackを停止します');
      try {
        const stopped = await runSupabase(registry, ['stop'], {
          capture: true,
          allowFailure: true,
          timeoutMs: 30_000,
        });
        if (stopped.code !== 0) {
          cleanupErrors.push(
            // stop出力もcredentialを含む可能性があるため、終了コードだけを報告する。
            new Error(`supabase stopが終了コード${stopped.code}で失敗しました`),
          );
        }
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (!releaseLock && lockPromise) {
      try {
        releaseLock = await lockPromise;
      } catch {
        // lock取得自体が失敗した場合は解放対象なし。
      }
    }
    if (releaseLock) {
      try {
        await releaseLock();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    interrupt.dispose();
  }

  const finalFailure = combineFailures(primaryError, cleanupErrors);
  if (finalFailure) throw finalFailure;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    if (error instanceof InterruptedError) {
      console.log(`✓ ${error.message}。所有していたローカルprocessを後始末しました`);
      process.exitCode = error.signal === 'SIGINT' ? 130 : error.signal === 'SIGHUP' ? 129 : 143;
    } else {
      console.error(`✗ ${error.message}`);
      if (error instanceof AggregateError) {
        for (const failure of error.errors) {
          console.error(`  - ${failure instanceof Error ? failure.message : String(failure)}`);
        }
      }
      if (error.cause?.message) console.error(`  cause: ${error.cause.message}`);
      process.exitCode = 1;
    }
  });
}
