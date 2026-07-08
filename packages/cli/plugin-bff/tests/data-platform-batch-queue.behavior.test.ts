import {
  type DataBatchRequestItem,
  type DataBatchRequestPayload,
  type DataBatchResponseItem,
  type DataBatchTransportEvent,
  type DataBatchTransportOptions,
  type DataTransportRequestInfo,
  DEFAULT_DATA_BATCH_ENDPOINT,
} from '../src/runtime/data-platform';
import { createBatchTransportQueue } from '../src/runtime/data-platform/batch/queue';

type BatchRequestPayload = DataBatchRequestPayload & {
  items: DataBatchRequestItem[];
};

type BatchFetch = NonNullable<DataBatchTransportOptions['fetch']>;

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init?.headers,
    },
    ...init,
  });

const parseBatchPayload = (init?: RequestInit): BatchRequestPayload =>
  JSON.parse(String(init?.body)) as BatchRequestPayload;

const createBatchResponse = (
  payload: BatchRequestPayload,
  mapItem: (item: DataBatchRequestItem, index: number) => unknown,
) =>
  jsonResponse({
    protocolVersion: 1,
    batchId: payload.batchId,
    receivedAt: Date.now(),
    items: payload.items.map(
      (item, index): DataBatchResponseItem => ({
        id: item.id,
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(mapItem(item, index)),
      }),
    ),
  });

const createQueue = (
  fetch: BatchFetch,
  events: DataBatchTransportEvent[],
  options: Partial<DataBatchTransportOptions> = {},
) =>
  createBatchTransportQueue({
    baseFetch: fetch,
    options: {
      flushIntervalMs: 20,
      maxBatchSize: 16,
      maxBatchBytes: 64 * 1024,
      onEvent: event => events.push(event),
      ...options,
    },
  });

const advance = async (ms: number) => {
  await rs.advanceTimersByTimeAsync(ms);
  await Promise.resolve();
};

describe('createBatchTransportQueue behavior', () => {
  test('flushes a single queued item through runSingle on the interval timer', async () => {
    rs.useFakeTimers();
    const events: DataBatchTransportEvent[] = [];
    const fetchMock = rs.fn(
      async (
        input: DataTransportRequestInfo,
        init?: RequestInit,
      ): Promise<Response> => {
        expect(String(input)).toBe('http://localhost/api/single');
        expect(init?.method).toBe('GET');
        return jsonResponse({ source: 'single', url: String(input) });
      },
    );

    try {
      const request = createQueue(fetchMock, events, { flushIntervalMs: 25 });

      const pending = request('http://localhost/api/single', {
        method: 'GET',
      });

      expect(fetchMock).toHaveBeenCalledTimes(0);
      await advance(24);
      expect(fetchMock).toHaveBeenCalledTimes(0);
      await advance(1);

      await expect(pending).resolves.toEqual({
        source: 'single',
        url: 'http://localhost/api/single',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(events).toEqual([
        {
          type: 'enqueue',
          endpoint: `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
          size: 1,
        },
        {
          type: 'flush',
          endpoint: `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
          size: 1,
          reason: undefined,
        },
      ]);
    } finally {
      rs.useRealTimers();
    }
  });

  test('groups batches by endpoint and flushes each endpoint on its interval timer', async () => {
    rs.useFakeTimers();
    const events: DataBatchTransportEvent[] = [];
    const batchCalls: Array<{ endpoint: string; paths: string[] }> = [];
    const fetchMock = rs.fn(
      async (
        input: DataTransportRequestInfo,
        init?: RequestInit,
      ): Promise<Response> => {
        const payload = parseBatchPayload(init);
        batchCalls.push({
          endpoint: String(input),
          paths: payload.items.map(item => item.path),
        });
        return createBatchResponse(payload, item => ({
          endpoint: String(input),
          path: item.path,
        }));
      },
    );

    try {
      const request = createQueue(fetchMock, events, {
        flushIntervalMs: 10,
        maxBatchSize: 8,
      });

      const pending = Promise.all([
        request('http://one.test/api/a', { method: 'GET' }),
        request('http://one.test/api/b?x=1', { method: 'GET' }),
        request('http://two.test/api/c', { method: 'GET' }),
        request('http://two.test/api/d', { method: 'GET' }),
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(0);
      await advance(9);
      expect(fetchMock).toHaveBeenCalledTimes(0);
      await advance(1);

      await expect(pending).resolves.toEqual([
        {
          endpoint: `http://one.test${DEFAULT_DATA_BATCH_ENDPOINT}`,
          path: '/api/a',
        },
        {
          endpoint: `http://one.test${DEFAULT_DATA_BATCH_ENDPOINT}`,
          path: '/api/b?x=1',
        },
        {
          endpoint: `http://two.test${DEFAULT_DATA_BATCH_ENDPOINT}`,
          path: '/api/c',
        },
        {
          endpoint: `http://two.test${DEFAULT_DATA_BATCH_ENDPOINT}`,
          path: '/api/d',
        },
      ]);
      expect(batchCalls).toEqual(
        expect.arrayContaining([
          {
            endpoint: `http://one.test${DEFAULT_DATA_BATCH_ENDPOINT}`,
            paths: ['/api/a', '/api/b?x=1'],
          },
          {
            endpoint: `http://two.test${DEFAULT_DATA_BATCH_ENDPOINT}`,
            paths: ['/api/c', '/api/d'],
          },
        ]),
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        events
          .filter(event => event.type === 'flush')
          .map(event => ({
            endpoint: event.endpoint,
            size: event.size,
          })),
      ).toEqual(
        expect.arrayContaining([
          {
            endpoint: `http://one.test${DEFAULT_DATA_BATCH_ENDPOINT}`,
            size: 2,
          },
          {
            endpoint: `http://two.test${DEFAULT_DATA_BATCH_ENDPOINT}`,
            size: 2,
          },
        ]),
      );
    } finally {
      rs.useRealTimers();
    }
  });

  test('flushes immediately when maxBatchSize or maxBatchBytes is reached', async () => {
    rs.useFakeTimers();
    const sizeEvents: DataBatchTransportEvent[] = [];
    const bytesEvents: DataBatchTransportEvent[] = [];
    const batchCalls: Array<{ endpoint: string; paths: string[] }> = [];
    const fetchMock = rs.fn(
      async (
        input: DataTransportRequestInfo,
        init?: RequestInit,
      ): Promise<Response> => {
        const payload = parseBatchPayload(init);
        batchCalls.push({
          endpoint: String(input),
          paths: payload.items.map(item => item.path),
        });
        return createBatchResponse(payload, item => ({
          path: item.path,
        }));
      },
    );

    try {
      const bySize = createQueue(fetchMock, sizeEvents, {
        flushIntervalMs: 100,
        maxBatchSize: 2,
      });
      const sizeResults = Promise.all([
        bySize('http://localhost/api/size-a', { method: 'GET' }),
        bySize('http://localhost/api/size-b', { method: 'GET' }),
      ]);

      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expect(sizeResults).resolves.toEqual([
        { path: '/api/size-a' },
        { path: '/api/size-b' },
      ]);

      const byBytes = createQueue(fetchMock, bytesEvents, {
        flushIntervalMs: 100,
        maxBatchSize: 8,
        maxBatchBytes: 1024,
      });
      const longA = `/api/bytes-${'a'.repeat(500)}`;
      const longB = `/api/bytes-${'b'.repeat(500)}`;
      const bytesResults = Promise.all([
        byBytes(`http://localhost${longA}`, { method: 'GET' }),
        byBytes(`http://localhost${longB}`, { method: 'GET' }),
      ]);

      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await expect(bytesResults).resolves.toEqual([
        { path: longA },
        { path: longB },
      ]);
      expect(batchCalls).toEqual([
        {
          endpoint: `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
          paths: ['/api/size-a', '/api/size-b'],
        },
        {
          endpoint: `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
          paths: [longA, longB],
        },
      ]);
      expect(sizeEvents).toContainEqual(
        expect.objectContaining({ type: 'flush', size: 2 }),
      );
      expect(bytesEvents).toContainEqual(
        expect.objectContaining({ type: 'flush', size: 2 }),
      );
    } finally {
      rs.useRealTimers();
    }
  });

  test('keeps items queued during an in-flight flush until their interval timer fires', async () => {
    rs.useFakeTimers();
    const events: DataBatchTransportEvent[] = [];
    let releaseFirstBatch!: () => void;
    let firstBatchReleased = false;
    const batchCalls: string[][] = [];
    const fetchMock = rs.fn(
      async (
        input: DataTransportRequestInfo,
        init?: RequestInit,
      ): Promise<Response> => {
        expect(String(input)).toBe(
          `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
        );
        const payload = parseBatchPayload(init);
        batchCalls.push(payload.items.map(item => item.path));

        if (!firstBatchReleased) {
          await new Promise<void>(resolve => {
            releaseFirstBatch = () => {
              firstBatchReleased = true;
              resolve();
            };
          });
        }

        return createBatchResponse(payload, item => ({
          path: item.path,
        }));
      },
    );

    try {
      const request = createQueue(fetchMock, events, {
        flushIntervalMs: 30,
        maxBatchSize: 8,
      });

      const firstBatch = Promise.all([
        request('http://localhost/api/in-flight-a', { method: 'GET' }),
        request('http://localhost/api/in-flight-b', { method: 'GET' }),
      ]);

      await advance(30);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const queuedDuringFlush = Promise.all([
        request('http://localhost/api/queued-a', { method: 'GET' }),
        request('http://localhost/api/queued-b', { method: 'GET' }),
      ]);
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      releaseFirstBatch();
      await expect(firstBatch).resolves.toEqual([
        { path: '/api/in-flight-a' },
        { path: '/api/in-flight-b' },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await advance(29);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await advance(1);

      await expect(queuedDuringFlush).resolves.toEqual([
        { path: '/api/queued-a' },
        { path: '/api/queued-b' },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(batchCalls).toEqual([
        ['/api/in-flight-a', '/api/in-flight-b'],
        ['/api/queued-a', '/api/queued-b'],
      ]);
    } finally {
      rs.useRealTimers();
    }
  });

  test('returns the same promise for stable-key duplicate in-flight requests', async () => {
    rs.useFakeTimers();
    const events: DataBatchTransportEvent[] = [];
    const fetchMock = rs.fn(
      async (
        input: DataTransportRequestInfo,
        init?: RequestInit,
      ): Promise<Response> => {
        expect(String(input)).toBe('http://localhost/api/dedupe');
        expect(init?.method).toBe('GET');
        return jsonResponse({ value: 'deduped' });
      },
    );

    try {
      const request = createQueue(fetchMock, events, { flushIntervalMs: 10 });

      const first = request('http://localhost/api/dedupe', {
        headers: {
          'x-stable': 'same',
        },
        method: 'GET',
      });
      const second = request('http://localhost/api/dedupe', {
        method: 'GET',
        headers: {
          'x-stable': 'same',
        },
      });

      expect(second).toBe(first);
      await advance(10);
      await expect(Promise.all([first, second])).resolves.toEqual([
        { value: 'deduped' },
        { value: 'deduped' },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(events.filter(event => event.type === 'enqueue')).toHaveLength(1);
    } finally {
      rs.useRealTimers();
    }
  });

  for (const status of [404, 405]) {
    test(`${status} disables the batch endpoint and subsequent requests bypass it`, async () => {
      rs.useFakeTimers();
      const events: DataBatchTransportEvent[] = [];
      const fetchMock = rs.fn(
        async (input: DataTransportRequestInfo): Promise<Response> => {
          const url = String(input);
          if (url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
            return new Response('unavailable', {
              status,
              headers: {
                'content-type': 'text/plain',
              },
            });
          }

          return jsonResponse({ url });
        },
      );

      try {
        const request = createQueue(fetchMock, events, {
          flushIntervalMs: 10,
          maxBatchSize: 8,
        });
        const firstPair = Promise.all([
          request('http://localhost/api/disabled-a', { method: 'GET' }),
          request('http://localhost/api/disabled-b', { method: 'GET' }),
        ]);

        await advance(10);
        await expect(firstPair).resolves.toEqual([
          { url: 'http://localhost/api/disabled-a' },
          { url: 'http://localhost/api/disabled-b' },
        ]);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
          `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
          'http://localhost/api/disabled-a',
          'http://localhost/api/disabled-b',
        ]);
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'disable',
            endpoint: `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
            reason: `batch-endpoint-unavailable-${String(status)}`,
          }),
        );

        const bypassed = request('http://localhost/api/disabled-c', {
          method: 'GET',
        });

        expect(fetchMock).toHaveBeenCalledTimes(4);
        await expect(bypassed).resolves.toEqual({
          url: 'http://localhost/api/disabled-c',
        });
        expect(fetchMock.mock.calls[3]?.[0]).toBe(
          'http://localhost/api/disabled-c',
        );
      } finally {
        rs.useRealTimers();
      }
    });
  }

  test('falls back to per-item requests for non-2xx and invalid batch responses', async () => {
    for (const scenario of [
      {
        name: 'non-2xx',
        response: () =>
          jsonResponse(
            { error: 'upstream' },
            {
              status: 500,
            },
          ),
        reason: 'batch-response-500',
      },
      {
        name: 'invalid-response',
        response: () => jsonResponse({ not: 'a batch response' }),
        reason: 'invalid-batch-response',
      },
    ]) {
      rs.useFakeTimers();
      const events: DataBatchTransportEvent[] = [];
      const fetchMock = rs.fn(
        async (
          input: DataTransportRequestInfo,
          init?: RequestInit,
        ): Promise<Response> => {
          const url = String(input);
          if (url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
            parseBatchPayload(init);
            return scenario.response();
          }

          return jsonResponse({ scenario: scenario.name, url });
        },
      );

      try {
        const request = createQueue(fetchMock, events, {
          flushIntervalMs: 10,
          maxBatchSize: 8,
        });
        const pending = Promise.all([
          request(`http://localhost/api/${scenario.name}-a`, {
            method: 'GET',
          }),
          request(`http://localhost/api/${scenario.name}-b`, {
            method: 'GET',
          }),
        ]);

        await advance(10);

        await expect(pending).resolves.toEqual([
          {
            scenario: scenario.name,
            url: `http://localhost/api/${scenario.name}-a`,
          },
          {
            scenario: scenario.name,
            url: `http://localhost/api/${scenario.name}-b`,
          },
        ]);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
          `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
          `http://localhost/api/${scenario.name}-a`,
          `http://localhost/api/${scenario.name}-b`,
        ]);
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'fallback',
            endpoint: `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
            reason: scenario.reason,
            size: 2,
          }),
        );
      } finally {
        rs.useRealTimers();
      }
    }
  });

  test('demuxes batch responses by id and falls back missing ids per item', async () => {
    rs.useFakeTimers();
    const events: DataBatchTransportEvent[] = [];
    const fetchMock = rs.fn(
      async (
        input: DataTransportRequestInfo,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = String(input);
        if (url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
          const payload = parseBatchPayload(init);
          const [, second] = payload.items;
          return jsonResponse({
            protocolVersion: 1,
            batchId: payload.batchId,
            receivedAt: Date.now(),
            items: [
              {
                id: second.id,
                status: 200,
                headers: {
                  'content-type': 'application/json; charset=utf-8',
                },
                body: JSON.stringify({
                  source: 'batch',
                  path: second.path,
                }),
              },
            ],
          });
        }

        return jsonResponse({ source: 'single', url });
      },
    );

    try {
      const request = createQueue(fetchMock, events, {
        flushIntervalMs: 10,
        maxBatchSize: 8,
      });
      const pending = Promise.all([
        request('http://localhost/api/missing-id-a', { method: 'GET' }),
        request('http://localhost/api/missing-id-b', { method: 'GET' }),
      ]);

      await advance(10);

      await expect(pending).resolves.toEqual([
        {
          source: 'single',
          url: 'http://localhost/api/missing-id-a',
        },
        {
          source: 'batch',
          path: '/api/missing-id-b',
        },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
        `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
        'http://localhost/api/missing-id-a',
      ]);
    } finally {
      rs.useRealTimers();
    }
  });

  test('aborts timed-out batch requests and falls back per item', async () => {
    rs.useFakeTimers();
    const events: DataBatchTransportEvent[] = [];
    let batchSignal: AbortSignal | undefined;
    const fetchMock = rs.fn(
      async (
        input: DataTransportRequestInfo,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = String(input);
        if (url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
          batchSignal = init?.signal;
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          });
        }

        return jsonResponse({ source: 'fallback', url });
      },
    );

    try {
      const request = createQueue(fetchMock, events, {
        flushIntervalMs: 10,
        maxBatchSize: 8,
        requestTimeoutMs: 25,
      });
      const pending = Promise.all([
        request('http://localhost/api/timeout-a', { method: 'GET' }),
        request('http://localhost/api/timeout-b', { method: 'GET' }),
      ]);

      await advance(10);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(batchSignal?.aborted).toBe(false);

      await advance(25);

      await expect(pending).resolves.toEqual([
        {
          source: 'fallback',
          url: 'http://localhost/api/timeout-a',
        },
        {
          source: 'fallback',
          url: 'http://localhost/api/timeout-b',
        },
      ]);
      expect(batchSignal?.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
        `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
        'http://localhost/api/timeout-a',
        'http://localhost/api/timeout-b',
      ]);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'fallback',
          endpoint: `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
          reason: 'batch-timeout',
          size: 2,
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'fallback',
          endpoint: `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
          reason: 'batch-transport-error',
          size: 2,
        }),
      );
    } finally {
      rs.useRealTimers();
    }
  });
});
