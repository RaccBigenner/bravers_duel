export interface DeadlineFetchOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

function waitWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(signal.reason));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function responseWithDeadline(
  response: Response,
  signal: AbortSignal,
  cleanup: () => void,
): Response {
  const bodyReaders = new Set<PropertyKey>(['arrayBuffer', 'blob', 'formData', 'json', 'text']);
  return new Proxy(response, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (bodyReaders.has(property) && typeof value === 'function') {
        return async (...args: unknown[]) => {
          try {
            const operation = Reflect.apply(value, target, args) as Promise<unknown>;
            return await waitWithAbort(operation, signal);
          } finally {
            cleanup();
          }
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** fetchのheaders到着だけでなくresponse body readerまで同じdeadlineで覆う。 */
export function createDeadlineFetch(
  fetchImpl: typeof fetch,
  { timeoutMs, signal }: DeadlineFetchOptions,
): typeof fetch {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new TypeError('Invalid fetch deadline');
  }
  return async (input, init) => {
    const controller = new AbortController();
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const abort = (source?: AbortSignal) => {
      if (!controller.signal.aborted) {
        controller.abort(source?.reason ?? new Error('Request deadline exceeded'));
      }
    };
    if (signal?.aborted || requestSignal?.aborted) {
      throw signal?.reason ?? requestSignal?.reason ?? new Error('Request aborted');
    }

    const onOuterAbort = () => abort(signal);
    const onRequestAbort = () => abort(requestSignal);
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
      requestSignal?.removeEventListener('abort', onRequestAbort);
    };
    const timer = setTimeout(() => {
      abort();
      cleanup();
    }, timeoutMs);

    signal?.addEventListener('abort', onOuterAbort, { once: true });
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
