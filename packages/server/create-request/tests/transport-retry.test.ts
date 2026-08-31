import { executeWithResilience } from '../src/transport';

const requestUrl = 'https://modern.test/api';
const retryableStatusCodes = [408, 425, 429, 500, 502, 503, 504];
const nonRetryableStatusCodes = [400, 401, 404, 418, 501];

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createNamedError = (name: string) => {
  const error = new Error(name);
  (error as any).name = name;
  return error;
};

const createStatusError = (status: number) => {
  const error = new Error(`status ${status}`);
  (error as any).status = status;
  return error;
};

const executeRetryRequest = ({
  fetcher,
  method = 'GET',
  init = { method },
  retry,
  onDegraded,
}: {
  fetcher: (...args: any[]) => Promise<any>;
  method?: string;
  init?: Record<string, any>;
  retry?: Record<string, any>;
  onDegraded?: (event: any) => void;
}) =>
  executeWithResilience({
    requestId: 'transport-retry-test',
    target: 'browser',
    method,
    url: requestUrl,
    init,
    fetcher,
    transport: {
      retry,
      onDegraded,
    },
  });

describe('transport retry behavior', () => {
  test.each([
    'FetchError',
    'TimeoutError',
  ])('retries %s up to the configured max then rejects', async errorName => {
    rs.useFakeTimers();
    const errors = [
      createNamedError(errorName),
      createNamedError(errorName),
      createNamedError(errorName),
    ];
    let callCount = 0;
    const fetcher = rs.fn(async () => {
      const error = errors[callCount];
      callCount += 1;
      throw error;
    });

    const pending = executeRetryRequest({
      fetcher,
      retry: {
        retries: 2,
        baseDelayMs: 10,
        maxDelayMs: 100,
        jitterRatio: 0,
      },
    });
    const observed = pending.catch(error => error);

    try {
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);

      await rs.advanceTimersByTimeAsync(9);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await rs.advanceTimersByTimeAsync(1);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(2);

      await rs.advanceTimersByTimeAsync(19);
      expect(fetcher).toHaveBeenCalledTimes(2);
      await rs.advanceTimersByTimeAsync(1);
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(3);
      await expect(observed).resolves.toBe(errors[2]);
    } finally {
      await rs.advanceTimersByTimeAsync(1000);
      await observed;
      rs.useRealTimers();
    }
  });

  test('should not retry caller-aborted requests', async () => {
    rs.useFakeTimers();
    const onDegraded = rs.fn();
    const abortController = new AbortController();
    abortController.abort();
    const abortError = createNamedError('AbortError');
    const fetcher = rs.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBe(abortController.signal);
      throw abortError;
    });

    const pending = executeRetryRequest({
      fetcher,
      init: {
        method: 'GET',
        signal: abortController.signal,
      },
      retry: {
        retries: 2,
        baseDelayMs: 1,
        maxDelayMs: 1,
        jitterRatio: 0,
      },
      onDegraded,
    });
    const observed = pending.catch(error => error);

    try {
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(onDegraded).not.toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'retry' }),
      );
      await expect(observed).resolves.toBe(abortError);
    } finally {
      await rs.advanceTimersByTimeAsync(5);
      await observed;
      rs.useRealTimers();
    }
  });

  test('retries default retryable status codes after the backoff delay', async () => {
    rs.useFakeTimers();

    try {
      for (const statusCode of retryableStatusCodes) {
        const retryableError = createStatusError(statusCode);
        const response = { ok: true, status: 200 };
        let callCount = 0;
        const fetcher = rs.fn(async () => {
          callCount += 1;
          if (callCount === 1) {
            throw retryableError;
          }
          return response;
        });

        const pending = executeRetryRequest({
          fetcher,
          retry: {
            retries: 1,
            baseDelayMs: 5,
            maxDelayMs: 5,
            jitterRatio: 0,
          },
        });

        await flushMicrotasks();
        expect(fetcher).toHaveBeenCalledTimes(1);
        await rs.advanceTimersByTimeAsync(4);
        expect(fetcher).toHaveBeenCalledTimes(1);
        await rs.advanceTimersByTimeAsync(1);
        await expect(pending).resolves.toBe(response);
        expect(fetcher).toHaveBeenCalledTimes(2);
      }
    } finally {
      await rs.advanceTimersByTimeAsync(1000);
      rs.useRealTimers();
    }
  });

  test('does not retry non-retryable status codes', async () => {
    for (const statusCode of nonRetryableStatusCodes) {
      const error = createStatusError(statusCode);
      const fetcher = rs.fn(async () => {
        throw error;
      });

      await expect(
        executeRetryRequest({
          fetcher,
          retry: {
            retries: 2,
            baseDelayMs: 1,
            maxDelayMs: 1,
            jitterRatio: 0,
          },
        }),
      ).rejects.toBe(error);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  test('uses a custom shouldRetry predicate instead of default rules', async () => {
    rs.useFakeTimers();
    const retryableByPolicy = createStatusError(400);
    const response = { ok: true, status: 200 };
    const shouldRetry = rs.fn(() => true);
    let callCount = 0;
    const fetcher = rs.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw retryableByPolicy;
      }
      return response;
    });

    const pending = executeRetryRequest({
      fetcher,
      method: 'POST',
      init: { method: 'POST' },
      retry: {
        retries: 1,
        baseDelayMs: 7,
        maxDelayMs: 7,
        jitterRatio: 0,
        shouldRetry,
      },
    });

    try {
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(shouldRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          error: retryableByPolicy,
          maxAttempts: 2,
          method: 'POST',
          statusCode: 400,
        }),
      );

      await rs.advanceTimersByTimeAsync(6);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await rs.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBe(response);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      await rs.advanceTimersByTimeAsync(1000);
      rs.useRealTimers();
    }
  });

  test('does not retry non-idempotent methods by default', async () => {
    const error = createNamedError('FetchError');
    const fetcher = rs.fn(async () => {
      throw error;
    });

    await expect(
      executeRetryRequest({
        fetcher,
        method: 'POST',
        init: { method: 'POST' },
        retry: {
          retries: 2,
          baseDelayMs: 1,
          maxDelayMs: 1,
          jitterRatio: 0,
        },
      }),
    ).rejects.toBe(error);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('timeout aborts the in-flight request when a caller signal is present', async () => {
    rs.useFakeTimers();
    const callerController = new AbortController();
    const onDegraded = rs.fn();
    let inFlightSignal: AbortSignal | undefined;
    const fetcher = rs.fn((_url: string, init: RequestInit) => {
      inFlightSignal = init.signal || undefined;
      return new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(createNamedError('AbortError'));
        });
      });
    });

    const pending = executeWithResilience({
      requestId: 'transport-timeout-with-caller-signal',
      target: 'browser',
      method: 'GET',
      url: requestUrl,
      init: {
        method: 'GET',
        signal: callerController.signal,
      },
      fetcher,
      transport: {
        timeoutMs: 25,
        onDegraded,
      },
    });
    const observed = pending.catch(error => error);

    try {
      await flushMicrotasks();
      expect(inFlightSignal?.aborted).toBe(false);
      await rs.advanceTimersByTimeAsync(25);

      await expect(observed).resolves.toMatchObject({ name: 'TimeoutError' });
      expect(inFlightSignal?.aborted).toBe(true);
      expect(callerController.signal.aborted).toBe(false);
      expect(onDegraded).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'timeout', timeoutMs: 25 }),
      );
    } finally {
      await rs.advanceTimersByTimeAsync(1000);
      await observed;
      rs.useRealTimers();
    }
  });

  test('caller abort still cancels a request that has a timeout', async () => {
    rs.useFakeTimers();
    const callerController = new AbortController();
    const onDegraded = rs.fn();
    let inFlightSignal: AbortSignal | undefined;
    const abortError = createNamedError('AbortError');
    const fetcher = rs.fn((_url: string, init: RequestInit) => {
      inFlightSignal = init.signal || undefined;
      return new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(abortError));
      });
    });

    const pending = executeWithResilience({
      requestId: 'transport-caller-abort-with-timeout',
      target: 'browser',
      method: 'GET',
      url: requestUrl,
      init: {
        method: 'GET',
        signal: callerController.signal,
      },
      fetcher,
      transport: {
        timeoutMs: 25,
        onDegraded,
      },
    });
    const observed = pending.catch(error => error);

    try {
      await flushMicrotasks();
      callerController.abort();

      await expect(observed).resolves.toBe(abortError);
      expect(inFlightSignal?.aborted).toBe(true);
      expect(onDegraded).not.toHaveBeenCalled();
    } finally {
      await rs.advanceTimersByTimeAsync(1000);
      await observed;
      rs.useRealTimers();
    }
  });
});
