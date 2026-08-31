import {
  type DataBatchRequestItem,
  type DataBatchRequestPayload,
  type DataBatchResponseItem,
  type DataBatchTransportEvent,
  type DataBatchTransportOptions,
  type DataTransportRequestInfo,
  DEFAULT_DATA_BATCH_ENDPOINT,
} from '../src/runtime/data-platform';
import {
  BatchBucketRegistry,
  createBatchTransportQueue,
} from '../src/runtime/data-platform/batch/queue';
import { createDataPlatformBatchRequestHandler } from '../src/runtime/effect/handler/batch-handler';

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
  bucketRegistry?: BatchBucketRegistry,
) =>
  createBatchTransportQueue({
    baseFetch: fetch,
    bucketRegistry,
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
  test('releases completed credential buckets while retaining active and replacement buckets', async () => {
    const registry = new BatchBucketRegistry();
    const fetchMock = rs.fn(async (input, init?: RequestInit) => {
      if (!String(input).endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
        return jsonResponse({ path: new URL(String(input)).pathname });
      }
      const payload = parseBatchPayload(init);
      return createBatchResponse(payload, item => ({ path: item.path }));
    });
    const request = createQueue(
      fetchMock,
      [],
      { flushIntervalMs: 0, maxBatchSize: 2 },
      registry,
    );
    const pending: Promise<unknown>[] = [];

    for (let index = 0; index < 128; index += 1) {
      const headers = {
        authorization: `Bearer credential-${String(index)}`,
        cookie: `session=credential-${String(index)}`,
      };
      pending.push(
        request(`http://localhost/api/${String(index)}-a`, {
          method: 'GET',
          headers,
        }),
      );
      if (index % 2 === 0) {
        pending.push(
          request(`http://localhost/api/${String(index)}-b`, {
            method: 'GET',
            headers,
          }),
        );
      }
    }

    expect(await Promise.all(pending)).toHaveLength(192);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(128);
    expect(registry.size).toBe(0);

    const flushing = registry.ensure('flushing');
    flushing.flushing = true;
    expect(registry.releaseIfIdle('flushing', flushing)).toBe(false);
    flushing.flushing = false;
    expect(registry.releaseIfIdle('flushing', flushing)).toBe(true);

    const timed = registry.ensure('timed');
    timed.timer = setTimeout(() => {}, 60_000);
    expect(registry.releaseIfIdle('timed', timed)).toBe(false);
    clearTimeout(timed.timer);
    timed.timer = null;
    expect(registry.releaseIfIdle('timed', timed)).toBe(true);

    const queued = registry.ensure('queued');
    queued.items.push({} as never);
    expect(registry.releaseIfIdle('queued', queued)).toBe(false);
    queued.items.pop();
    expect(registry.releaseIfIdle('queued', queued)).toBe(true);

    const stale = registry.ensure('reused');
    expect(registry.releaseIfIdle('reused', stale)).toBe(true);
    const replacement = registry.ensure('reused');
    expect(registry.releaseIfIdle('reused', stale)).toBe(false);
    expect(registry.get('reused')).toBe(replacement);
    expect(registry.releaseIfIdle('reused', replacement)).toBe(true);
    expect(registry.size).toBe(0);
  });

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

  test('binds queued items to partitioned outer auth without promoting spoofed identity', async () => {
    rs.useFakeTimers();
    const events: DataBatchTransportEvent[] = [];
    const authContexts: Array<{
      name: string;
      authorization: string;
      cookie: string;
      credentials: RequestCredentials;
      requestInput?: boolean;
    }> = [
      {
        name: 'cookie-alpha',
        authorization: 'Bearer shared',
        cookie: 'session=alpha',
        credentials: 'same-origin',
      },
      {
        name: 'cookie-beta',
        authorization: 'Bearer shared',
        cookie: 'session=beta',
        credentials: 'same-origin',
      },
      {
        name: 'auth-gamma',
        authorization: 'Bearer gamma',
        cookie: 'session=alpha',
        credentials: 'same-origin',
      },
      {
        name: 'request-include',
        authorization: 'Bearer shared',
        cookie: 'session=alpha',
        credentials: 'include',
        requestInput: true,
      },
    ];
    const batchHandler = createDataPlatformBatchRequestHandler({
      handleItem: async request =>
        jsonResponse({
          path: new URL(request.url).pathname,
          authorization: request.headers.get('authorization'),
          cookie: request.headers.get('cookie'),
          tenant: request.headers.get('x-tenant-id'),
          subject: request.headers.get('x-subject-id'),
          user: request.headers.get('x-user-id'),
          verifiedProducer: request.headers.get('x-verified-producer'),
          forwardedFor: request.headers.get('x-forwarded-for'),
          origin: request.headers.get('origin'),
        }),
    });
    const clientOuterRequests: Array<{
      authorization: string | null;
      cookie: string | null;
      credentials: RequestCredentials | null;
      paths: string[];
      itemCredentials: Array<{
        authorization: string | null;
        cookie: string | null;
      }>;
      tenant: string | null;
      subject: string | null;
      user: string | null;
      verifiedProducer: string | null;
      forwardedFor: string | null;
      origin: string | null;
    }> = [];
    const fetchMock = rs.fn(
      async (
        input: DataTransportRequestInfo,
        init?: RequestInit,
      ): Promise<Response> => {
        const headers = new Headers(init?.headers);
        const payload = parseBatchPayload(init);
        clientOuterRequests.push({
          authorization: headers.get('authorization'),
          cookie: headers.get('cookie'),
          credentials: init?.credentials ?? null,
          paths: payload.items.map(item => item.path),
          itemCredentials: payload.items.map(item => ({
            authorization: item.headers?.authorization ?? null,
            cookie: item.headers?.cookie ?? null,
          })),
          tenant: headers.get('x-tenant-id'),
          subject: headers.get('x-subject-id'),
          user: headers.get('x-user-id'),
          verifiedProducer: headers.get('x-verified-producer'),
          forwardedFor: headers.get('x-forwarded-for'),
          origin: headers.get('origin'),
        });

        headers.set('origin', 'https://trusted.example');
        headers.set('x-forwarded-for', '198.51.100.7');
        headers.set('x-subject-id', 'derived-subject');
        headers.set('x-tenant-id', 'derived-tenant');
        headers.set('x-user-id', 'derived-user');
        headers.set('x-verified-producer', 'derived-producer');
        return batchHandler.handle(
          new Request(String(input), { ...init, headers }),
        );
      },
    );

    try {
      const request = createQueue(fetchMock, events, {
        flushIntervalMs: 10,
        maxBatchSize: 8,
      });
      const pending = Promise.all(
        authContexts.flatMap(context =>
          ['a', 'b'].map(suffix => {
            const url = `http://localhost/api/${context.name}-${suffix}`;
            const init: RequestInit = {
              method: 'GET',
              credentials: context.credentials,
              headers: {
                authorization: context.authorization,
                cookie: context.cookie,
                origin: 'https://attacker.example',
                'x-forwarded-for': '203.0.113.9',
                'x-subject-id': `spoofed-subject-${context.name}`,
                'x-tenant-id': `spoofed-tenant-${context.name}`,
                'x-user-id': `spoofed-user-${context.name}`,
                'x-verified-producer': `spoofed-producer-${context.name}`,
              },
            };
            return context.requestInput
              ? request(new Request(url, init))
              : request(url, init);
          }),
        ),
      );

      await advance(10);
      await expect(pending).resolves.toEqual(
        authContexts.flatMap(context =>
          ['a', 'b'].map(suffix => ({
            path: `/api/${context.name}-${suffix}`,
            authorization: context.authorization,
            cookie: context.cookie,
            tenant: 'derived-tenant',
            subject: 'derived-subject',
            user: 'derived-user',
            verifiedProducer: 'derived-producer',
            forwardedFor: '198.51.100.7',
            origin: 'https://trusted.example',
          })),
        ),
      );
      const byIdentity = (value: {
        authorization: string | null;
        cookie: string | null;
        credentials: RequestCredentials | null;
      }) =>
        `${value.authorization || ''}\0${value.cookie || ''}\0${value.credentials || ''}`;
      expect(
        clientOuterRequests.sort((a, b) =>
          byIdentity(a).localeCompare(byIdentity(b)),
        ),
      ).toEqual(
        authContexts
          .map(context => ({
            authorization: context.authorization,
            cookie: context.cookie,
            credentials: context.credentials,
            paths: [`/api/${context.name}-a`, `/api/${context.name}-b`],
            itemCredentials: [
              { authorization: null, cookie: null },
              { authorization: null, cookie: null },
            ],
            tenant: null,
            subject: null,
            user: null,
            verifiedProducer: null,
            forwardedFor: null,
            origin: null,
          }))
          .sort((a, b) => byIdentity(a).localeCompare(byIdentity(b))),
      );
      expect(fetchMock).toHaveBeenCalledTimes(4);
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

  test('keeps identical intentional mutations as distinct batch items', async () => {
    rs.useFakeTimers();
    const events: DataBatchTransportEvent[] = [];
    let batchPaths: string[] = [];
    const fetchMock = rs.fn(
      async (
        input: DataTransportRequestInfo,
        init?: RequestInit,
      ): Promise<Response> => {
        const payload = parseBatchPayload(init);
        batchPaths = payload.items.map(item => item.path);
        return createBatchResponse(payload, (_item, index) => ({ index }));
      },
    );

    try {
      const request = createQueue(fetchMock, events, {
        flushIntervalMs: 10,
        allowedMethods: ['POST'],
      });
      const first = request('http://localhost/api/intentional-mutation', {
        method: 'POST',
      });
      const second = request('http://localhost/api/intentional-mutation', {
        method: 'POST',
      });

      expect(second).not.toBe(first);
      await advance(10);
      await expect(Promise.all([first, second])).resolves.toEqual([
        { index: 0 },
        { index: 1 },
      ]);
      expect(batchPaths).toEqual([
        '/api/intentional-mutation',
        '/api/intentional-mutation',
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
      );
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

  test('replays reads but not mutations after ambiguous batch responses', async () => {
    for (const scenario of [
      {
        name: 'non-2xx',
        method: 'POST',
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
        method: 'PUT',
        response: () => jsonResponse({ not: 'a batch response' }),
        reason: 'invalid-batch-response',
      },
      {
        name: 'malformed-json',
        method: 'PATCH',
        response: () =>
          new Response('{"protocolVersion":', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        reason: 'batch-transport-error',
      },
      {
        name: 'unknown-method',
        method: 'PURGE',
        response: () => jsonResponse({ error: 'upstream' }, { status: 503 }),
        reason: 'batch-response-503',
      },
    ]) {
      rs.useFakeTimers();
      const events: DataBatchTransportEvent[] = [];
      const mutationExecutions: string[] = [];
      const fetchMock = rs.fn(
        async (
          input: DataTransportRequestInfo,
          init?: RequestInit,
        ): Promise<Response> => {
          const url = String(input);
          if (url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
            const payload = parseBatchPayload(init);
            mutationExecutions.push(payload.items[0].path);
            return scenario.response();
          }

          if (init?.method !== 'GET') {
            mutationExecutions.push(new URL(url).pathname);
          }
          return jsonResponse({ scenario: scenario.name, url });
        },
      );

      try {
        const request = createQueue(fetchMock, events, {
          flushIntervalMs: 10,
          maxBatchSize: 8,
          allowedMethods: ['GET', scenario.method],
        });
        const pending = Promise.allSettled([
          request(`http://localhost/api/${scenario.name}-mutation`, {
            method: scenario.method,
          }),
          request(`http://localhost/api/${scenario.name}-read`, {
            method: 'GET',
          }),
        ]);

        await advance(10);

        await expect(pending).resolves.toEqual([
          expect.objectContaining({ status: 'rejected' }),
          {
            status: 'fulfilled',
            value: {
              scenario: scenario.name,
              url: `http://localhost/api/${scenario.name}-read`,
            },
          },
        ]);
        expect(mutationExecutions).toEqual([`/api/${scenario.name}-mutation`]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
          `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
          `http://localhost/api/${scenario.name}-read`,
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

  test('demuxes present reads without replaying a missing mutation result', async () => {
    rs.useFakeTimers();
    const events: DataBatchTransportEvent[] = [];
    const mutationExecutions: string[] = [];
    const fetchMock = rs.fn(
      async (
        input: DataTransportRequestInfo,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = String(input);
        if (url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
          const payload = parseBatchPayload(init);
          const [mutation, read] = payload.items;
          mutationExecutions.push(mutation.path);
          return jsonResponse({
            protocolVersion: 1,
            batchId: payload.batchId,
            receivedAt: Date.now(),
            items: [
              {
                id: read.id,
                status: 200,
                headers: {
                  'content-type': 'application/json; charset=utf-8',
                },
                body: JSON.stringify({
                  source: 'batch',
                  path: read.path,
                }),
              },
            ],
          });
        }

        if (init?.method === 'DELETE') {
          mutationExecutions.push(new URL(url).pathname);
        }
        return jsonResponse({ source: 'single', url });
      },
    );

    try {
      const request = createQueue(fetchMock, events, {
        flushIntervalMs: 10,
        maxBatchSize: 8,
        allowedMethods: ['GET', 'DELETE'],
      });
      const pending = Promise.allSettled([
        request('http://localhost/api/missing-id-mutation', {
          method: 'DELETE',
        }),
        request('http://localhost/api/missing-id-read', { method: 'GET' }),
      ]);

      await advance(10);

      await expect(pending).resolves.toEqual([
        expect.objectContaining({ status: 'rejected' }),
        {
          status: 'fulfilled',
          value: {
            source: 'batch',
            path: '/api/missing-id-read',
          },
        },
      ]);
      expect(mutationExecutions).toEqual(['/api/missing-id-mutation']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
        `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
      ]);
    } finally {
      rs.useRealTimers();
    }
  });

  test('does not replay a lost-response POST while retaining GET and HEAD fallback', async () => {
    rs.useFakeTimers();
    const events: DataBatchTransportEvent[] = [];
    const mutationExecutions: string[] = [];
    const fetchMock = rs.fn(
      async (
        input: DataTransportRequestInfo,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = String(input);
        if (url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
          const payload = parseBatchPayload(init);
          for (const item of payload.items) {
            if (item.method === 'POST') {
              mutationExecutions.push(item.path);
            }
          }
          throw new Error('batch response was lost after dispatch');
        }

        if (init?.method === 'POST') {
          mutationExecutions.push(new URL(url).pathname);
        }
        return jsonResponse({ source: 'fallback', url });
      },
    );

    try {
      const request = createQueue(fetchMock, events, {
        flushIntervalMs: 10,
        maxBatchSize: 8,
        allowedMethods: ['GET', 'HEAD', 'POST'],
      });
      const post = request('http://localhost/api/mutation', {
        method: 'POST',
      });
      const get = request('http://localhost/api/read', { method: 'GET' });
      const head = request('http://localhost/api/head', { method: 'HEAD' });
      const results = Promise.allSettled([post, get, head]);

      await advance(10);

      const [postResult, getResult, headResult] = await results;
      expect(postResult.status).toBe('rejected');
      expect(getResult).toEqual({
        status: 'fulfilled',
        value: {
          source: 'fallback',
          url: 'http://localhost/api/read',
        },
      });
      expect(headResult).toEqual({
        status: 'fulfilled',
        value: {
          source: 'fallback',
          url: 'http://localhost/api/head',
        },
      });
      expect(mutationExecutions).toEqual(['/api/mutation']);
      expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
        `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
        'http://localhost/api/read',
        'http://localhost/api/head',
      ]);
    } finally {
      rs.useRealTimers();
    }
  });

  test('aborts timed-out batches without replaying mutations', async () => {
    rs.useFakeTimers();
    const events: DataBatchTransportEvent[] = [];
    let batchSignal: AbortSignal | undefined;
    const mutationExecutions: string[] = [];
    const fetchMock = rs.fn(
      async (
        input: DataTransportRequestInfo,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = String(input);
        if (url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
          batchSignal = init?.signal;
          const payload = parseBatchPayload(init);
          mutationExecutions.push(
            ...payload.items
              .filter(item => item.method === 'POST')
              .map(item => item.path),
          );
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          });
        }

        if (init?.method === 'POST') {
          mutationExecutions.push(new URL(url).pathname);
        }
        return jsonResponse({ source: 'fallback', url });
      },
    );

    try {
      const request = createQueue(fetchMock, events, {
        flushIntervalMs: 10,
        maxBatchSize: 8,
        requestTimeoutMs: 25,
        allowedMethods: ['GET', 'POST'],
      });
      const pending = Promise.allSettled([
        request('http://localhost/api/timeout-mutation', { method: 'POST' }),
        request('http://localhost/api/timeout-read', { method: 'GET' }),
      ]);

      await advance(10);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(batchSignal?.aborted).toBe(false);

      await advance(25);

      await expect(pending).resolves.toEqual([
        expect.objectContaining({ status: 'rejected' }),
        {
          status: 'fulfilled',
          value: {
            source: 'fallback',
            url: 'http://localhost/api/timeout-read',
          },
        },
      ]);
      expect(batchSignal?.aborted).toBe(true);
      expect(mutationExecutions).toEqual(['/api/timeout-mutation']);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
        `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
        'http://localhost/api/timeout-read',
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
