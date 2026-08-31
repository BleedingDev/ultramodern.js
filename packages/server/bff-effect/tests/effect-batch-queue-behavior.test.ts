import {
  createDataBatchTransport,
  type DataBatchRequestItem,
  type DataBatchRequestPayload,
  type DataBatchResponseItem,
  type DataBatchTransportEvent,
  type DataBatchTransportOptions,
  DEFAULT_DATA_BATCH_ENDPOINT,
} from '../src/data-platform';
import { createDataPlatformBatchRequestHandler } from '../src/effect/handler/batch-handler';

type BatchFetch = NonNullable<DataBatchTransportOptions['fetch']>;

const IDENTITY_HEADERS = [
  'origin',
  'forwarded',
  'x-forwarded-client-cert',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-real-ip',
  'x-tenant-id',
  'x-subject-id',
  'x-user-id',
  'x-verified-producer',
] as const;

const parseBatchPayload = (init?: RequestInit) =>
  JSON.parse(String(init?.body)) as DataBatchRequestPayload;

const createBatchResponse = (
  payload: DataBatchRequestPayload,
  mapItem: (item: DataBatchRequestItem, index: number) => unknown,
) =>
  Response.json({
    protocolVersion: 2,
    batchId: payload.batchId,
    receivedAt: Date.now(),
    items: payload.items.map(
      (item, index): DataBatchResponseItem => ({
        id: item.id,
        status: 200,
        headers: [['content-type', 'application/json']],
        body: {
          encoding: 'base64',
          data: btoa(JSON.stringify(mapItem(item, index))),
        },
      }),
    ),
  });

const advance = async (milliseconds: number) => {
  await rs.advanceTimersByTimeAsync(milliseconds);
  await Promise.resolve();
};

describe('Effect batch queue behavior', () => {
  beforeEach(() => {
    rs.useFakeTimers();
  });

  afterEach(() => {
    rs.useRealTimers();
    rs.restoreAllMocks();
  });

  test('flushes a singleton only when its interval expires', async () => {
    const events: DataBatchTransportEvent[] = [];
    const fetchMock = rs.fn<BatchFetch>(async (input, init) => {
      expect(String(input)).toBe('http://localhost/api/single');
      expect(init?.method).toBe('GET');
      return Response.json({ source: 'single' });
    });
    const request = createDataBatchTransport({
      fetch: fetchMock,
      flushIntervalMs: 25,
      onEvent: event => events.push(event),
    });

    const pending = request('http://localhost/api/single');

    expect(fetchMock).not.toHaveBeenCalled();
    await advance(24);
    expect(fetchMock).not.toHaveBeenCalled();
    await advance(1);

    await expect(pending).resolves.toEqual({ source: 'single' });
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
  });

  test('demultiplexes responses when time and randomness collide', async () => {
    const timestamp = 1_725_000_000_000;
    rs.spyOn(Date, 'now').mockReturnValue(timestamp);
    rs.spyOn(Math, 'random').mockReturnValue(0.5);

    const itemIds: string[] = [];
    const fetchMock = rs.fn<BatchFetch>(async (_input, init) => {
      const payload = parseBatchPayload(init);
      itemIds.push(...payload.items.map(item => item.id));
      return Response.json({
        protocolVersion: 2,
        batchId: payload.batchId,
        receivedAt: timestamp,
        items: payload.items.toReversed().map(
          (item): DataBatchResponseItem => ({
            id: item.id,
            status: 200,
            headers: [['content-type', 'application/json']],
            body: {
              encoding: 'base64',
              data: btoa(JSON.stringify({ path: item.path })),
            },
          }),
        ),
      });
    });
    const request = createDataBatchTransport({
      allowedMethods: ['POST'],
      fetch: fetchMock,
      flushIntervalMs: 100,
      maxBatchSize: 2,
    });

    const pending = Promise.all([
      request('http://localhost/api/first', { method: 'POST' }),
      request('http://localhost/api/second', { method: 'POST' }),
    ]);

    await expect(pending).resolves.toEqual([
      { path: '/api/first' },
      { path: '/api/second' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(itemIds).toHaveLength(2);
    expect(new Set(itemIds).size).toBe(2);
  });

  test('partitions by endpoint, credentials, and outer auth without promoting spoofed identity', async () => {
    const batchPath = '/internal/data-batch';
    const trustedIdentity = Object.fromEntries(
      IDENTITY_HEADERS.map(name => [name, `trusted:${name}`]),
    );
    const handler = createDataPlatformBatchRequestHandler({
      dataPlatform: { batch: { endpoint: batchPath } },
      handleItem: async request =>
        Response.json({
          path: new URL(request.url).pathname,
          authorization: request.headers.get('authorization'),
          cookie: request.headers.get('cookie'),
          identity: Object.fromEntries(
            IDENTITY_HEADERS.map(name => [name, request.headers.get(name)]),
          ),
        }),
    });
    const outerRequests: Array<{
      endpoint: string;
      authorization: string | null;
      cookie: string | null;
      credentials: RequestCredentials | null;
      paths: string[];
      outerIdentity: Array<string | null>;
      itemCredentials: Array<Array<string | null>>;
      itemIdentity: Array<Array<string | null>>;
      serializedCredentials: boolean;
    }> = [];
    const fetchMock = rs.fn<BatchFetch>(async (input, init) => {
      const headers = new Headers(init?.headers);
      const serializedPayload = String(init?.body);
      const payload = JSON.parse(serializedPayload) as DataBatchRequestPayload;
      outerRequests.push({
        endpoint: String(input),
        authorization: headers.get('authorization'),
        cookie: headers.get('cookie'),
        credentials: init?.credentials ?? null,
        paths: payload.items.map(item => item.path),
        outerIdentity: IDENTITY_HEADERS.map(name => headers.get(name)),
        itemCredentials: payload.items.map(item => [
          item.headers?.authorization ?? null,
          item.headers?.cookie ?? null,
        ]),
        itemIdentity: payload.items.map(item =>
          IDENTITY_HEADERS.map(name => item.headers?.[name] ?? null),
        ),
        serializedCredentials: serializedPayload.includes('"credentials"'),
      });

      for (const [name, value] of Object.entries(trustedIdentity)) {
        headers.set(name, value);
      }
      return handler.handle(new Request(String(input), { ...init, headers }));
    });
    const request = createDataBatchTransport({
      endpoint: batchPath,
      fetch: fetchMock,
      flushIntervalMs: 100,
      maxBatchSize: 2,
    });
    const contexts: Array<{
      name: string;
      origin: string;
      authorization: string;
      cookie: string;
      credentials: RequestCredentials;
      requestInput?: boolean;
    }> = [
      {
        name: 'cookie-alpha',
        origin: 'http://one.test',
        authorization: 'Bearer shared',
        cookie: 'session=alpha',
        credentials: 'same-origin',
      },
      {
        name: 'cookie-beta',
        origin: 'http://one.test',
        authorization: 'Bearer shared',
        cookie: 'session=beta',
        credentials: 'same-origin',
      },
      {
        name: 'authorization-beta',
        origin: 'http://one.test',
        authorization: 'Bearer beta',
        cookie: 'session=alpha',
        credentials: 'same-origin',
      },
      {
        name: 'credentials-include',
        origin: 'http://one.test',
        authorization: 'Bearer shared',
        cookie: 'session=alpha',
        credentials: 'include',
        requestInput: true,
      },
      {
        name: 'other-origin',
        origin: 'http://two.test',
        authorization: 'Bearer shared',
        cookie: 'session=alpha',
        credentials: 'same-origin',
      },
    ];

    const pending = Promise.all(
      contexts.flatMap(context =>
        ['a', 'b'].map(suffix => {
          const url = `${context.origin}/api/${context.name}-${suffix}`;
          const init: RequestInit = {
            credentials: context.credentials,
            headers: {
              ...Object.fromEntries(
                IDENTITY_HEADERS.map(name => [
                  name,
                  `spoofed:${name}:${context.name}`,
                ]),
              ),
              authorization: context.authorization,
              cookie: context.cookie,
            },
          };
          return context.requestInput
            ? request(new Request(url, init))
            : request(url, init);
        }),
      ),
    );

    await expect(pending).resolves.toEqual(
      contexts.flatMap(context =>
        ['a', 'b'].map(suffix => ({
          path: `/api/${context.name}-${suffix}`,
          authorization: context.authorization,
          cookie: context.cookie,
          identity: trustedIdentity,
        })),
      ),
    );
    expect(outerRequests).toHaveLength(contexts.length);
    expect(
      outerRequests.map(call => ({
        endpoint: call.endpoint,
        authorization: call.authorization,
        cookie: call.cookie,
        credentials: call.credentials,
        paths: call.paths,
      })),
    ).toEqual(
      expect.arrayContaining(
        contexts.map(context => ({
          endpoint: `${context.origin}${batchPath}`,
          authorization: context.authorization,
          cookie: context.cookie,
          credentials: context.credentials,
          paths: [`/api/${context.name}-a`, `/api/${context.name}-b`],
        })),
      ),
    );
    expect(
      outerRequests.every(call =>
        call.outerIdentity.every(value => value === null),
      ),
    ).toBe(true);
    expect(
      outerRequests.every(call =>
        call.itemCredentials.every(values =>
          values.every(value => value === null),
        ),
      ),
    ).toBe(true);
    expect(
      outerRequests.every(call =>
        call.itemIdentity.every(values =>
          values.every(value => value?.startsWith('spoofed:')),
        ),
      ),
    ).toBe(true);
    expect(
      outerRequests.every(call => call.serializedCredentials === false),
    ).toBe(true);
  });

  test('holds requests enqueued during a flush for the next interval', async () => {
    let releaseFirstBatch!: () => void;
    let firstBatchReleased = false;
    const batches: string[][] = [];
    const fetchMock = rs.fn<BatchFetch>(async (_input, init) => {
      const payload = parseBatchPayload(init);
      batches.push(payload.items.map(item => item.path));
      if (!firstBatchReleased) {
        await new Promise<void>(resolve => {
          releaseFirstBatch = () => {
            firstBatchReleased = true;
            resolve();
          };
        });
      }
      return createBatchResponse(payload, item => ({ path: item.path }));
    });
    const request = createDataBatchTransport({
      fetch: fetchMock,
      flushIntervalMs: 30,
      maxBatchSize: 8,
    });

    const firstBatch = Promise.all([
      request('http://localhost/api/in-flight-a'),
      request('http://localhost/api/in-flight-b'),
    ]);
    await advance(30);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const nextBatch = Promise.all([
      request('http://localhost/api/queued-a'),
      request('http://localhost/api/queued-b'),
    ]);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releaseFirstBatch();
    await expect(firstBatch).resolves.toEqual([
      { path: '/api/in-flight-a' },
      { path: '/api/in-flight-b' },
    ]);
    await advance(29);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);

    await expect(nextBatch).resolves.toEqual([
      { path: '/api/queued-a' },
      { path: '/api/queued-b' },
    ]);
    expect(batches).toEqual([
      ['/api/in-flight-a', '/api/in-flight-b'],
      ['/api/queued-a', '/api/queued-b'],
    ]);
  });

  test('preserves inherited and non-enumerable POST bodies on the direct path', async () => {
    const bodies: Array<BodyInit | null | undefined> = [];
    const fetchMock = rs.fn<BatchFetch>(async (_input, init) => {
      bodies.push(init?.body);
      return Response.json({ body: init?.body });
    });
    const request = createDataBatchTransport({ fetch: fetchMock });
    const inheritedInit = Object.assign(
      Object.create({ body: 'inherited-body' }),
      { method: 'POST' },
    ) as RequestInit;
    const nonEnumerableInit = { method: 'POST' } as RequestInit;
    Object.defineProperty(nonEnumerableInit, 'body', {
      value: 'non-enumerable-body',
    });

    await expect(
      Promise.all([
        request('http://localhost/api/inherited-body', inheritedInit),
        request('http://localhost/api/non-enumerable-body', nonEnumerableInit),
      ]),
    ).resolves.toEqual([
      { body: 'inherited-body' },
      { body: 'non-enumerable-body' },
    ]);
    expect(bodies).toEqual(['inherited-body', 'non-enumerable-body']);
  });

  test('deduplicates unsignaled reads but preserves identical mutations', async () => {
    const calls: Array<{ url: string; paths?: string[] }> = [];
    const fetchMock = rs.fn<BatchFetch>(async (input, init) => {
      const url = String(input);
      if (!url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
        calls.push({ url });
        return Response.json({ value: 'deduped' });
      }
      const payload = parseBatchPayload(init);
      calls.push({ url, paths: payload.items.map(item => item.path) });
      return createBatchResponse(payload, (_item, index) => ({ index }));
    });
    const request = createDataBatchTransport({
      allowedMethods: ['GET', 'POST'],
      fetch: fetchMock,
      flushIntervalMs: 10,
      maxBatchSize: 2,
    });

    const firstRead = request('http://localhost/api/dedupe', {
      headers: { 'x-stable': 'same' },
    });
    const secondRead = request('http://localhost/api/dedupe', {
      headers: { 'x-stable': 'same' },
    });
    expect(secondRead).toBe(firstRead);
    const reads = Promise.all([firstRead, secondRead]);
    await advance(10);
    await expect(reads).resolves.toEqual([
      { value: 'deduped' },
      { value: 'deduped' },
    ]);

    const mutations = Promise.all([
      request('http://localhost/api/mutation', { method: 'POST' }),
      request('http://localhost/api/mutation', { method: 'POST' }),
    ]);
    await expect(mutations).resolves.toEqual([{ index: 0 }, { index: 1 }]);
    expect(calls).toEqual([
      { url: 'http://localhost/api/dedupe' },
      {
        url: `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
        paths: ['/api/mutation', '/api/mutation'],
      },
    ]);
  });
});
