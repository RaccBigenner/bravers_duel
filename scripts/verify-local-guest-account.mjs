import { createClient } from '@supabase/supabase-js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stableFailure(message) {
  return new Error(`local guest account smoke: ${message}`);
}

function waitWithAbort(operation, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(signal.reason));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(operation).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function responseWithDeadline(response, signal, cleanup) {
  const bodyReaders = new Set(['arrayBuffer', 'blob', 'formData', 'json', 'text']);
  return new Proxy(response, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (bodyReaders.has(property) && typeof value === 'function') {
        return async (...args) => {
          try {
            return await waitWithAbort(Reflect.apply(value, target, args), signal);
          } finally {
            cleanup();
          }
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function fetchWithDeadline(fetchImpl, timeoutMs) {
  return async (input, init) => {
    const controller = new AbortController();
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    let cleanedUp = false;
    const onRequestAbort = () => controller.abort(requestSignal?.reason);
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timer);
      requestSignal?.removeEventListener('abort', onRequestAbort);
    };
    const timer = setTimeout(() => {
      controller.abort(stableFailure('request timeout'));
      cleanup();
    }, timeoutMs);

    if (requestSignal?.aborted) {
      cleanup();
      throw requestSignal.reason;
    }
    requestSignal?.addEventListener('abort', onRequestAbort, { once: true });
    try {
      const response = await waitWithAbort(
        Promise.resolve(fetchImpl(input, { ...init, signal: controller.signal })),
        controller.signal,
      );
      if (response.body === null) {
        cleanup();
        return response;
      }
      return responseWithDeadline(response, controller.signal, cleanup);
    } catch (error) {
      cleanup();
      throw error;
    }
  };
}

function withDeadline(operation, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(stableFailure(`${label} timeout`)), timeoutMs);
    Promise.resolve(operation).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function localAuthConfigFromStatus(result) {
  if (!result || result.code !== 0 || typeof result.stdout !== 'string') {
    throw stableFailure('Supabase statusを取得できません');
  }

  let status;
  try {
    status = JSON.parse(result.stdout.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '').trim());
  } catch {
    throw stableFailure('Supabase status JSONが不正です');
  }

  const apiUrl = status?.API_URL;
  const publishableKey = status?.PUBLISHABLE_KEY;
  const secretKey = status?.SECRET_KEY;
  let parsedUrl;
  try {
    parsedUrl = new URL(apiUrl);
  } catch {
    throw stableFailure('local API URLが不正です');
  }

  const loopback =
    parsedUrl.hostname === '127.0.0.1' ||
    parsedUrl.hostname === 'localhost' ||
    parsedUrl.hostname === '[::1]';
  if (
    parsedUrl.protocol !== 'http:' ||
    !loopback ||
    parsedUrl.username ||
    parsedUrl.password ||
    (parsedUrl.pathname !== '' && parsedUrl.pathname !== '/') ||
    parsedUrl.search ||
    parsedUrl.hash ||
    typeof publishableKey !== 'string' ||
    !publishableKey.startsWith('sb_publishable_') ||
    typeof secretKey !== 'string' ||
    !secretKey.startsWith('sb_secret_')
  ) {
    throw stableFailure('local Auth credentialが安全な形式ではありません');
  }

  return {
    apiUrl: parsedUrl.toString().replace(/\/$/, ''),
    publishableKey,
    secretKey,
  };
}

function localClient(createClientImpl, apiUrl, apiKey, fetchImpl) {
  return createClientImpl(apiUrl, apiKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
      skipAutoInitialize: true,
    },
    global: { fetch: fetchImpl },
  });
}

/**
 * GoTrue匿名signup→同一UUIDのaccount root→admin削除cascadeを実local stackで検証する。
 * key/token/upstream messageは例外やconsoleへ含めない。
 */
export async function verifyLocalGuestAccount(
  statusResult,
  { createClientImpl = createClient, fetchImpl = fetch, requestTimeoutMs = 10_000 } = {},
) {
  const { apiUrl, publishableKey, secretKey } = localAuthConfigFromStatus(statusResult);
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 30_000) {
    throw stableFailure('request timeout設定が不正です');
  }
  let guestClient = null;
  let adminClient = null;
  let accountId = null;
  let primaryFailure = null;
  const cleanupFailures = [];

  try {
    const scopedFetch = fetchWithDeadline(fetchImpl, requestTimeoutMs);
    guestClient = localClient(createClientImpl, apiUrl, publishableKey, scopedFetch);
    adminClient = localClient(createClientImpl, apiUrl, secretKey, scopedFetch);
    const signup = await withDeadline(
      guestClient.auth.signInAnonymously(),
      requestTimeoutMs,
      'anonymous signup',
    );
    accountId = UUID_PATTERN.test(signup.data?.user?.id ?? '') ? signup.data.user.id : null;
    if (
      signup.error ||
      !accountId ||
      signup.data.user.is_anonymous !== true ||
      signup.data.session?.user?.id !== accountId ||
      !signup.data.session.access_token ||
      !signup.data.session.refresh_token
    ) {
      throw stableFailure('匿名signup応答が不正です');
    }

    const directRead = await withDeadline(
      guestClient.from('account').select('account_id').eq('account_id', accountId).maybeSingle(),
      requestTimeoutMs,
      'anonymous direct read',
    );
    if (directRead.error?.code !== '42501') {
      throw stableFailure('匿名clientのaccount root直接read拒否を確認できません');
    }

    const serviceRead = await withDeadline(
      adminClient.from('account').select('account_id').eq('account_id', accountId).maybeSingle(),
      requestTimeoutMs,
      'service account read',
    );
    if (serviceRead.error || serviceRead.data?.account_id !== accountId) {
      throw stableFailure('Auth userと同一UUIDのaccount rootがありません');
    }
  } catch (error) {
    primaryFailure = error instanceof Error && error.message.startsWith('local guest account smoke:')
      ? error
      : stableFailure('検証requestに失敗しました');
  }

  if (accountId && adminClient) {
    try {
      const deleted = await withDeadline(
        adminClient.auth.admin.deleteUser(accountId),
        requestTimeoutMs,
        'Auth user cleanup',
      );
      if (deleted.error) throw stableFailure('test Auth userを削除できません');

      const afterDelete = await withDeadline(
        adminClient.from('account').select('account_id').eq('account_id', accountId).maybeSingle(),
        requestTimeoutMs,
        'cascade確認',
      );
      if (afterDelete.error || afterDelete.data !== null) {
        throw stableFailure('Auth user削除後もaccount rootが残っています');
      }
    } catch (error) {
      cleanupFailures.push(
        error instanceof Error && error.message.startsWith('local guest account smoke:')
          ? error
          : stableFailure('test accountの後始末に失敗しました'),
      );
    }
  }

  if (primaryFailure && cleanupFailures.length > 0) {
    throw new AggregateError(
      [primaryFailure, ...cleanupFailures],
      'local guest account smoke: 検証と後始末に失敗しました',
    );
  }
  if (primaryFailure) throw primaryFailure;
  if (cleanupFailures.length > 0) throw cleanupFailures[0];
  return { accountId };
}
