import { executeWithResilience } from '../src/transport';

test('should not retry caller-aborted requests', async () => {
  rs.useFakeTimers();
  const onDegraded = rs.fn();
  const abortController = new AbortController();
  abortController.abort();
  const abortError = new Error('caller aborted');
  (abortError as any).name = 'AbortError';
  const fetcher = rs.fn(async (_url: string, init: RequestInit) => {
    expect(init.signal).toBe(abortController.signal);
    throw abortError;
  });

  const pending = executeWithResilience({
    requestId: 'default',
    target: 'browser',
    method: 'GET',
    url: 'https://modern.test/api',
    init: {
      method: 'GET',
      signal: abortController.signal,
    },
    fetcher,
    transport: {
      retry: {
        retries: 2,
        baseDelayMs: 1,
        maxDelayMs: 1,
        jitterRatio: 0,
      },
      onDegraded,
    },
  });
  const observed = pending.catch(error => error);

  try {
    await Promise.resolve();
    await Promise.resolve();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onDegraded).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'retry' }),
    );
    await expect(pending).rejects.toBe(abortError);
  } finally {
    await rs.advanceTimersByTimeAsync(5);
    await observed;
    rs.useRealTimers();
  }
});
