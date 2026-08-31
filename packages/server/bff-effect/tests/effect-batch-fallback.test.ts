import {
  createDataBatchTransport,
  type DataBatchRequestItem,
  type DataBatchRequestPayload,
  type DataBatchResponseItem,
  type DataBatchTransportEvent,
  type DataBatchTransportOptions,
  DEFAULT_DATA_BATCH_ENDPOINT,
} from '../src/data-platform';

type BatchFetch = NonNullable<DataBatchTransportOptions['fetch']>;

const jsonResponse = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(body), { ...init, headers });
};

const parseBatchPayload = (init?: RequestInit) =>
  JSON.parse(String(init?.body)) as DataBatchRequestPayload;

const jsonBatchItem = (
  item: DataBatchRequestItem,
  body: unknown,
): DataBatchResponseItem => ({
  id: item.id,
  status: 200,
  headers: [['content-type', 'application/json; charset=utf-8']],
  body: {
    encoding: 'base64',
    data: btoa(JSON.stringify(body)),
  },
});

const createTransport = (
  fetch: BatchFetch,
  options: Partial<DataBatchTransportOptions> = {},
) =>
  createDataBatchTransport({
    allowedMethods: ['GET'],
    flushIntervalMs: 1_000,
    maxBatchSize: 2,
    fetch,
    ...options,
  });

describe('Effect batch fallback behavior', () => {
  for (const status of [404, 405]) {
    test(`${status} disables the batch endpoint and makes future requests bypass it`, async () => {
      const events: DataBatchTransportEvent[] = [];
      const calls: string[] = [];
      const transport = createTransport(
        async input => {
          const url = String(input);
          calls.push(url);
          if (url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
            return new Response('unavailable', { status });
          }
          return jsonResponse({ url });
        },
        {
          allowedMethods: ['GET', 'HEAD'],
          onEvent: event => events.push(event),
        },
      );

      await expect(
        Promise.all([
          transport('http://localhost/api/disabled-a'),
          transport('http://localhost/api/disabled-b', { method: 'HEAD' }),
        ]),
      ).resolves.toEqual([
        { url: 'http://localhost/api/disabled-a' },
        { url: 'http://localhost/api/disabled-b' },
      ]);
      expect(calls).toEqual([
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

      await expect(
        transport('http://localhost/api/disabled-c'),
      ).resolves.toEqual({ url: 'http://localhost/api/disabled-c' });
      expect(calls).toEqual([
        `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
        'http://localhost/api/disabled-a',
        'http://localhost/api/disabled-b',
        'http://localhost/api/disabled-c',
      ]);
    });
  }

  test('replays a read but never a mutation after malformed or non-2xx batch responses', async () => {
    const scenarios = [
      {
        name: 'invalid-payload',
        reason: 'invalid-batch-response',
        response: () => jsonResponse({ not: 'a batch response' }),
      },
      {
        name: 'malformed-json',
        reason: 'batch-transport-error',
        response: () =>
          new Response('{', {
            headers: { 'content-type': 'application/json' },
          }),
      },
      {
        name: 'non-2xx',
        reason: 'batch-response-500',
        response: () => jsonResponse({ error: 'upstream' }, { status: 500 }),
      },
    ];

    for (const scenario of scenarios) {
      const events: DataBatchTransportEvent[] = [];
      const calls: string[] = [];
      const mutationExecutions: string[] = [];
      const transport = createTransport(
        async (input, init) => {
          const url = String(input);
          calls.push(url);
          if (url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
            const payload = parseBatchPayload(init);
            mutationExecutions.push(
              ...payload.items
                .filter(item => item.method === 'POST')
                .map(item => item.path),
            );
            return scenario.response();
          }
          if (init?.method === 'POST') {
            mutationExecutions.push(new URL(url).pathname);
          }
          return jsonResponse({ source: 'fallback', url });
        },
        {
          allowedMethods: ['GET', 'POST'],
          onEvent: event => events.push(event),
        },
      );

      const outcomes = await Promise.allSettled([
        transport(`http://localhost/api/${scenario.name}-mutation`, {
          method: 'POST',
        }),
        transport(`http://localhost/api/${scenario.name}-read`),
      ]);

      expect(outcomes).toEqual([
        {
          status: 'rejected',
          reason: expect.objectContaining({
            message: expect.stringContaining(scenario.reason),
          }),
        },
        {
          status: 'fulfilled',
          value: {
            source: 'fallback',
            url: `http://localhost/api/${scenario.name}-read`,
          },
        },
      ]);
      expect(mutationExecutions).toEqual([`/api/${scenario.name}-mutation`]);
      expect(calls).toEqual([
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
    }
  });

  test('demuxes a present read without replaying a missing mutation result', async () => {
    const calls: string[] = [];
    const mutationExecutions: string[] = [];
    const transport = createTransport(
      async (input, init) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
          const payload = parseBatchPayload(init);
          const mutation = payload.items.find(item => item.method === 'DELETE');
          const read = payload.items.find(item => item.method === 'GET');
          if (!mutation || !read) {
            throw new Error('Expected one mutation and one read');
          }
          mutationExecutions.push(mutation.path);
          return jsonResponse({
            protocolVersion: 2,
            batchId: payload.batchId,
            receivedAt: Date.now(),
            items: [
              jsonBatchItem(read, {
                source: 'batch',
                path: read.path,
              }),
            ],
          });
        }
        if (init?.method === 'DELETE') {
          mutationExecutions.push(new URL(url).pathname);
        }
        return jsonResponse({ source: 'single', url });
      },
      { allowedMethods: ['GET', 'DELETE'] },
    );

    const outcomes = await Promise.allSettled([
      transport('http://localhost/api/missing-mutation', {
        method: 'DELETE',
      }),
      transport('http://localhost/api/present-read'),
    ]);

    expect(outcomes).toEqual([
      {
        status: 'rejected',
        reason: expect.objectContaining({
          message: expect.stringContaining('missing-batch-result'),
        }),
      },
      {
        status: 'fulfilled',
        value: {
          source: 'batch',
          path: '/api/present-read',
        },
      },
    ]);
    expect(mutationExecutions).toEqual(['/api/missing-mutation']);
    expect(calls).toEqual([`http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`]);
  });

  test('demuxes a present mutation and safely replays a missing read result', async () => {
    const calls: string[] = [];
    const mutationExecutions: string[] = [];
    const transport = createTransport(
      async (input, init) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
          const payload = parseBatchPayload(init);
          const mutation = payload.items.find(item => item.method === 'POST');
          const read = payload.items.find(item => item.method === 'GET');
          if (!mutation || !read) {
            throw new Error('Expected one mutation and one read');
          }
          mutationExecutions.push(mutation.path);
          return jsonResponse({
            protocolVersion: 2,
            batchId: payload.batchId,
            receivedAt: Date.now(),
            items: [
              jsonBatchItem(mutation, {
                source: 'batch',
                path: mutation.path,
              }),
            ],
          });
        }
        if (init?.method === 'POST') {
          mutationExecutions.push(new URL(url).pathname);
        }
        return jsonResponse({ source: 'single', url });
      },
      { allowedMethods: ['GET', 'POST'] },
    );

    const outcomes = await Promise.allSettled([
      transport('http://localhost/api/present-mutation', { method: 'POST' }),
      transport('http://localhost/api/missing-read'),
    ]);

    expect(outcomes).toEqual([
      {
        status: 'fulfilled',
        value: {
          source: 'batch',
          path: '/api/present-mutation',
        },
      },
      {
        status: 'fulfilled',
        value: {
          source: 'single',
          url: 'http://localhost/api/missing-read',
        },
      },
    ]);
    expect(mutationExecutions).toEqual(['/api/present-mutation']);
    expect(calls).toEqual([
      `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
      'http://localhost/api/missing-read',
    ]);
  });

  test('replays GET and HEAD but never POST or unknown methods after a batch transport error', async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const mutationExecutions: string[] = [];
    const events: DataBatchTransportEvent[] = [];
    const transport = createTransport(
      async (input, init) => {
        const url = String(input);
        const method = init?.method || 'GET';
        calls.push({ method, url });
        if (url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
          const payload = parseBatchPayload(init);
          mutationExecutions.push(
            ...payload.items
              .filter(item => item.method === 'POST')
              .map(item => item.path),
          );
          throw new Error('batch response was lost after dispatch');
        }
        if (method === 'POST') {
          mutationExecutions.push(new URL(url).pathname);
        }
        return jsonResponse({ source: 'fallback', url });
      },
      {
        allowedMethods: ['GET', 'HEAD', 'POST', 'UNKNOWN'],
        maxBatchSize: 4,
        onEvent: event => events.push(event),
      },
    );

    const outcomes = await Promise.allSettled([
      transport('http://localhost/api/mutation', { method: 'POST' }),
      transport('http://localhost/api/read'),
      transport('http://localhost/api/head', { method: 'HEAD' }),
      transport('http://localhost/api/unknown', { method: 'UNKNOWN' }),
    ]);

    expect(outcomes).toEqual([
      {
        status: 'rejected',
        reason: expect.objectContaining({
          message: expect.stringContaining('batch-transport-error'),
        }),
      },
      {
        status: 'fulfilled',
        value: {
          source: 'fallback',
          url: 'http://localhost/api/read',
        },
      },
      {
        status: 'fulfilled',
        value: {
          source: 'fallback',
          url: 'http://localhost/api/head',
        },
      },
      {
        status: 'rejected',
        reason: expect.objectContaining({
          message: expect.stringContaining('batch-transport-error'),
        }),
      },
    ]);
    expect(mutationExecutions).toEqual(['/api/mutation']);
    expect(calls).toEqual([
      {
        method: 'POST',
        url: `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
      },
      { method: 'GET', url: 'http://localhost/api/read' },
      { method: 'HEAD', url: 'http://localhost/api/head' },
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'fallback',
        endpoint: `http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
        reason: 'batch-transport-error',
        size: 4,
      }),
    );
  });

  test.each([
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
  ] as const)('bypasses batching for %s by default', async method => {
    const path = method.toLowerCase();
    const calls: Array<{ method: string; url: string }> = [];
    const transport = createDataBatchTransport({
      fetch: async (input, init) => {
        const call = {
          method: init?.method || 'GET',
          url: String(input),
        };
        calls.push(call);
        return jsonResponse(call);
      },
    });

    await expect(
      transport(`http://localhost/api/default-${path}`, { method }),
    ).resolves.toEqual({
      method,
      url: `http://localhost/api/default-${path}`,
    });
    expect(calls).toEqual([
      { method, url: `http://localhost/api/default-${path}` },
    ]);
  });
});
