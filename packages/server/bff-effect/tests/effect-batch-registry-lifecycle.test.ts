import {
  type DataBatchRequestPayload,
  DEFAULT_DATA_BATCH_ENDPOINT,
} from '../src/data-platform';
import {
  BatchBucketRegistry,
  createBatchTransportQueue,
} from '../src/data-platform/batch/queue';
import { stableStringify } from '../src/data-platform/codec';

const parseBatchPayload = (init?: RequestInit) =>
  JSON.parse(String(init?.body)) as DataBatchRequestPayload;

const createBatchResponse = (payload: DataBatchRequestPayload) =>
  Response.json({
    protocolVersion: 2,
    batchId: payload.batchId,
    receivedAt: Date.now(),
    items: payload.items.map(item => ({
      id: item.id,
      status: 200,
      headers: [['content-type', 'application/json']],
      body: {
        encoding: 'base64',
        data: btoa(JSON.stringify({ path: item.path })),
      },
    })),
  });

const toBucketKey = (endpoint: string) =>
  stableStringify({
    endpoint,
    authorization: null,
    cookie: null,
    credentials: 'same-origin',
  });

const advance = async (milliseconds: number) => {
  await rs.advanceTimersByTimeAsync(milliseconds);
  await Promise.resolve();
};

describe('Effect batch bucket registry lifecycle', () => {
  beforeEach(() => {
    rs.useFakeTimers();
  });

  afterEach(() => {
    rs.useRealTimers();
    rs.restoreAllMocks();
  });

  test('releaseIfIdle retains an active flush until its requests settle', async () => {
    const registry = new BatchBucketRegistry();
    let releaseFetch!: () => void;
    const fetchMock = rs.fn(async (_input, init?: RequestInit) => {
      const payload = parseBatchPayload(init);
      await new Promise<void>(resolve => {
        releaseFetch = resolve;
      });
      return createBatchResponse(payload);
    });
    const request = createBatchTransportQueue({
      baseFetch: fetchMock,
      bucketRegistry: registry,
      options: { flushIntervalMs: 1_000, maxBatchSize: 2 },
    });

    const pending = Promise.all([
      request('http://localhost/api/first'),
      request('http://localhost/api/second'),
    ]);
    await Promise.resolve();
    await Promise.resolve();

    const bucketKey = toBucketKey(
      `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
    );
    const bucket = registry.get(bucketKey);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bucket).toBeDefined();
    expect(registry.releaseIfIdle(bucketKey, bucket!)).toBe(false);
    expect(registry.size).toBe(1);

    releaseFetch();
    await expect(pending).resolves.toEqual([
      { path: '/api/first' },
      { path: '/api/second' },
    ]);
    expect(registry.size).toBe(0);
  });

  test('releaseIfIdle retains a live timer and rejects stale bucket identity', () => {
    const registry = new BatchBucketRegistry();
    const timed = registry.ensure('timed');
    timed.timer = setTimeout(() => {}, 1_000);

    expect(registry.releaseIfIdle('timed', timed)).toBe(false);
    expect(registry.size).toBe(1);

    clearTimeout(timed.timer);
    timed.timer = null;
    expect(registry.releaseIfIdle('timed', timed)).toBe(true);

    const current = registry.ensure('timed');
    expect(current).not.toBe(timed);
    expect(registry.releaseIfIdle('timed', timed)).toBe(false);
    expect(registry.get('timed')).toBe(current);
    expect(registry.releaseIfIdle('timed', current)).toBe(true);
    expect(registry.size).toBe(0);
  });

  test('releaseIfIdle retains a nonempty queue without a live timer', async () => {
    const registry = new BatchBucketRegistry();
    const fetchMock = rs.fn(async () => Response.json({ unexpected: true }));
    const controller = new AbortController();
    const reason = new DOMException('stop queued request', 'AbortError');
    const request = createBatchTransportQueue({
      baseFetch: fetchMock,
      bucketRegistry: registry,
      options: { flushIntervalMs: 1_000, maxBatchSize: 8 },
    });

    const pending = request('http://localhost/api/queued', {
      signal: controller.signal,
    });
    await Promise.resolve();

    const bucketKey = toBucketKey(
      `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
    );
    const bucket = registry.get(bucketKey);
    expect(bucket).toBeDefined();
    expect(bucket?.timer).not.toBeNull();
    clearTimeout(bucket!.timer!);
    bucket!.timer = null;

    expect(registry.releaseIfIdle(bucketKey, bucket!)).toBe(false);
    expect(registry.size).toBe(1);

    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });

  test('isolates origins and custom endpoint paths in a shared registry', async () => {
    const registry = new BatchBucketRegistry();
    const calls: string[] = [];
    const baseFetch = rs.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      return Response.json({ url });
    });
    const createQueue = (endpoint: string) =>
      createBatchTransportQueue({
        baseFetch,
        bucketRegistry: registry,
        options: { endpoint, flushIntervalMs: 25, maxBatchSize: 8 },
      });
    const alpha = createQueue('/internal/batch-alpha');
    const beta = createQueue('/internal/batch-beta');

    const pending = Promise.all([
      alpha('http://one.test/api/alpha-one'),
      alpha('http://two.test/api/alpha-two'),
      beta('http://one.test/api/beta-one'),
      beta('http://two.test/api/beta-two'),
    ]);
    await Promise.resolve();

    expect(registry.size).toBe(4);
    expect(baseFetch).not.toHaveBeenCalled();
    await advance(24);
    expect(baseFetch).not.toHaveBeenCalled();
    await advance(1);

    await expect(pending).resolves.toEqual([
      { url: 'http://one.test/api/alpha-one' },
      { url: 'http://two.test/api/alpha-two' },
      { url: 'http://one.test/api/beta-one' },
      { url: 'http://two.test/api/beta-two' },
    ]);
    expect(calls).toEqual([
      'http://one.test/api/alpha-one',
      'http://two.test/api/alpha-two',
      'http://one.test/api/beta-one',
      'http://two.test/api/beta-two',
    ]);
    expect(registry.size).toBe(0);
  });
});
