import {
  type DataBatchRequestPayload,
  type DataBatchTransportEvent,
  DEFAULT_DATA_BATCH_ENDPOINT,
} from '../src/data-platform';
import {
  BatchBucketRegistry,
  createBatchTransportQueue,
} from '../src/data-platform/batch/queue';

const batchResponse = (payload: DataBatchRequestPayload) =>
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

const parseBatchPayload = (init?: RequestInit) =>
  JSON.parse(String(init?.body)) as DataBatchRequestPayload;

const createQueue = (
  fetch: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
  options: {
    allowedMethods?: string[];
    flushIntervalMs?: number;
    maxBatchSize?: number;
    requestTimeoutMs?: number;
    onEvent?: (event: DataBatchTransportEvent) => void;
  } = {},
  bucketRegistry?: BatchBucketRegistry,
) =>
  createBatchTransportQueue({
    baseFetch: fetch,
    bucketRegistry,
    options: {
      flushIntervalMs: 100,
      maxBatchSize: 8,
      ...options,
    },
  });

const advance = async (milliseconds: number) => {
  await rs.advanceTimersByTimeAsync(milliseconds);
  await Promise.resolve();
};

describe('Effect batch cancellation and deadlines', () => {
  beforeEach(() => {
    rs.useFakeTimers();
  });

  afterEach(() => {
    rs.useRealTimers();
    rs.restoreAllMocks();
  });

  test('rejects an already-aborted request without enqueueing or fetching', async () => {
    const registry = new BatchBucketRegistry();
    const fetchMock = rs.fn(async () => Response.json({ unexpected: true }));
    const controller = new AbortController();
    const reason = new DOMException('caller stopped', 'AbortError');
    controller.abort(reason);

    const request = createQueue(fetchMock, {}, registry);
    await expect(
      request('http://localhost/already-aborted', {
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });

  test('removes an aborted queued item and batches only the survivors', async () => {
    const registry = new BatchBucketRegistry();
    const payloads: DataBatchRequestPayload[] = [];
    const fetchMock = rs.fn(async (input, init?: RequestInit) => {
      expect(String(input)).toBe(
        `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
      );
      const payload = parseBatchPayload(init);
      payloads.push(payload);
      return batchResponse(payload);
    });
    const request = createQueue(fetchMock, { maxBatchSize: 2 }, registry);
    const controller = new AbortController();
    const reason = new DOMException('queued caller stopped', 'AbortError');

    const aborted = request('http://localhost/removed', {
      signal: controller.signal,
    });
    const abortedOutcome = Promise.allSettled([aborted]);
    await Promise.resolve();
    expect(registry.size).toBe(1);
    controller.abort(reason);
    await expect(abortedOutcome).resolves.toEqual([
      { status: 'rejected', reason },
    ]);

    const survivors = Promise.all([
      request('http://localhost/survivor-a'),
      request('http://localhost/survivor-b'),
    ]);
    await expect(survivors).resolves.toEqual([
      { path: '/survivor-a' },
      { path: '/survivor-b' },
    ]);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.items.map(item => item.path)).toEqual([
      '/survivor-a',
      '/survivor-b',
    ]);
    expect(registry.size).toBe(0);
  });

  test('does not deduplicate a signaled caller or abort its shared-key peer', async () => {
    let resolveBatch: ((response: Response) => void) | undefined;
    let payload: DataBatchRequestPayload | undefined;
    let batchSignal: AbortSignal | null | undefined;
    const fetchMock = rs.fn(async (_input, init?: RequestInit) => {
      payload = parseBatchPayload(init);
      batchSignal = init?.signal;
      return new Promise<Response>(resolve => {
        resolveBatch = resolve;
      });
    });
    const request = createQueue(fetchMock, { maxBatchSize: 2 });
    const controller = new AbortController();
    const reason = new DOMException('only one caller stopped', 'AbortError');

    const signaled = request('http://localhost/same-key', {
      signal: controller.signal,
    });
    const unsignaled = request('http://localhost/same-key');
    const outcomes = Promise.allSettled([signaled, unsignaled]);
    await Promise.resolve();
    await Promise.resolve();
    expect(payload?.items).toHaveLength(2);

    controller.abort(reason);
    await Promise.resolve();
    expect(batchSignal?.aborted).toBe(false);
    resolveBatch?.(batchResponse(payload!));

    await expect(outcomes).resolves.toEqual([
      { status: 'rejected', reason },
      { status: 'fulfilled', value: { path: '/same-key' } },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('aborts the outer POST only after every in-flight caller aborts', async () => {
    const registry = new BatchBucketRegistry();
    const events: DataBatchTransportEvent[] = [];
    let batchSignal: AbortSignal | null | undefined;
    const fetchMock = rs.fn(async (_input, init?: RequestInit) => {
      batchSignal = init?.signal;
      return new Promise<Response>(() => {});
    });
    const request = createQueue(
      fetchMock,
      { maxBatchSize: 2, onEvent: event => events.push(event) },
      registry,
    );
    const firstController = new AbortController();
    const secondController = new AbortController();
    const firstReason = new DOMException('first stopped', 'AbortError');
    const secondReason = new DOMException('second stopped', 'AbortError');
    const outcomes = Promise.allSettled([
      request('http://localhost/first', {
        signal: firstController.signal,
      }),
      request('http://localhost/second', {
        signal: secondController.signal,
      }),
    ]);

    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    firstController.abort(firstReason);
    expect(batchSignal?.aborted).toBe(false);
    secondController.abort(secondReason);

    await expect(outcomes).resolves.toEqual([
      { status: 'rejected', reason: firstReason },
      { status: 'rejected', reason: secondReason },
    ]);
    await Promise.resolve();
    expect(batchSignal?.aborted).toBe(true);
    expect(registry.size).toBe(0);
    expect(
      events.filter(event => event.reason === 'batch-transport-error'),
    ).toHaveLength(0);
  });

  test('starts the deadline while queued and frees the pending key', async () => {
    const registry = new BatchBucketRegistry();
    const payloads: DataBatchRequestPayload[] = [];
    const fetchMock = rs.fn(async (_input, init?: RequestInit) => {
      const payload = parseBatchPayload(init);
      payloads.push(payload);
      return batchResponse(payload);
    });
    const request = createQueue(
      fetchMock,
      { flushIntervalMs: 100, maxBatchSize: 2, requestTimeoutMs: 20 },
      registry,
    );

    const expired = request('http://localhost/reusable');
    const expiredOutcome = Promise.allSettled([expired]);
    await advance(20);
    await expect(expiredOutcome).resolves.toEqual([
      {
        status: 'rejected',
        reason: expect.objectContaining({ name: 'TimeoutError' }),
      },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);

    await expect(
      Promise.all([
        request('http://localhost/reusable'),
        request('http://localhost/peer'),
      ]),
    ).resolves.toEqual([{ path: '/reusable' }, { path: '/peer' }]);
    expect(payloads[0]?.items.map(item => item.path)).toEqual([
      '/reusable',
      '/peer',
    ]);
    expect(registry.size).toBe(0);
  });

  test('does not retain an empty bucket after oversized singleton fallback', async () => {
    const registry = new BatchBucketRegistry();
    const fetchMock = rs.fn(async (_input: string | URL | Request) =>
      Response.json({ direct: true }),
    );
    const request = createBatchTransportQueue({
      baseFetch: fetchMock,
      bucketRegistry: registry,
      options: {
        flushIntervalMs: 1_000,
        maxBatchBytes: 1_024,
      },
    });

    await expect(
      request(`http://localhost/${'x'.repeat(2_000)}`, {
        headers: {
          authorization: 'Bearer unique-credential',
          cookie: 'session=unique-partition',
        },
      }),
    ).resolves.toEqual({ direct: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain(
      DEFAULT_DATA_BATCH_ENDPOINT,
    );
    expect(registry.size).toBe(0);
  });

  test('does not replay reads or mutations after their in-flight deadline', async () => {
    const registry = new BatchBucketRegistry();
    const events: DataBatchTransportEvent[] = [];
    const calls: string[] = [];
    const mutationExecutions: string[] = [];
    let batchSignal: AbortSignal | null | undefined;
    const fetchMock = rs.fn(async (input, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
        batchSignal = init?.signal;
        const payload = parseBatchPayload(init);
        mutationExecutions.push(
          ...payload.items
            .filter(item => item.method === 'POST')
            .map(item => item.path),
        );
        return new Promise<Response>(() => {});
      }
      return Response.json({ replayed: true });
    });
    const request = createQueue(
      fetchMock,
      {
        allowedMethods: ['GET', 'POST'],
        maxBatchSize: 2,
        requestTimeoutMs: 25,
        onEvent: event => events.push(event),
      },
      registry,
    );
    const outcomes = Promise.allSettled([
      request('http://localhost/mutation', { method: 'POST' }),
      request('http://localhost/read'),
    ]);

    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([`http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`]);
    await advance(25);

    await expect(outcomes).resolves.toEqual([
      {
        status: 'rejected',
        reason: expect.objectContaining({ name: 'TimeoutError' }),
      },
      {
        status: 'rejected',
        reason: expect.objectContaining({ name: 'TimeoutError' }),
      },
    ]);
    expect(batchSignal?.aborted).toBe(true);
    expect(mutationExecutions).toEqual(['/mutation']);
    expect(calls).toEqual([`http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`]);
    expect(
      events.filter(event => event.reason === 'batch-timeout'),
    ).toHaveLength(1);
    expect(
      events.filter(event => event.reason === 'batch-transport-error'),
    ).toHaveLength(0);
    expect(registry.size).toBe(0);
  });

  test('carries the remaining deadline into safe replay', async () => {
    const registry = new BatchBucketRegistry();
    const calls: string[] = [];
    const fetchMock = rs.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
        return new Response('unavailable', { status: 503 });
      }
      return new Promise<Response>(() => {});
    });
    const request = createQueue(
      fetchMock,
      { maxBatchSize: 2, requestTimeoutMs: 25 },
      registry,
    );
    const outcomes = Promise.allSettled([
      request('http://localhost/replay-a'),
      request('http://localhost/replay-b'),
    ]);

    await advance(0);
    expect(calls).toEqual([
      `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
      'http://localhost/replay-a',
      'http://localhost/replay-b',
    ]);
    await advance(25);

    await expect(outcomes).resolves.toEqual([
      {
        status: 'rejected',
        reason: expect.objectContaining({ name: 'TimeoutError' }),
      },
      {
        status: 'rejected',
        reason: expect.objectContaining({ name: 'TimeoutError' }),
      },
    ]);
    expect(calls).toHaveLength(3);
    expect(registry.size).toBe(0);
  });

  test('honors the signal carried by a source Request', async () => {
    const fetchMock = rs.fn(async () => Response.json({ unexpected: true }));
    const controller = new AbortController();
    const reason = new DOMException('source request stopped', 'AbortError');
    const sourceRequest = new Request('http://localhost/source-signal', {
      signal: controller.signal,
    });
    const request = createQueue(fetchMock);
    const pending = request(sourceRequest);
    const outcome = Promise.allSettled([pending]);
    await Promise.resolve();
    controller.abort(reason);

    await expect(outcome).resolves.toEqual([{ status: 'rejected', reason }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
