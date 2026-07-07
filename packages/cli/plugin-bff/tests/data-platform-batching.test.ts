import {
  createDataBatchTransport,
  DEFAULT_DATA_BATCH_ENDPOINT,
} from '../src/runtime/data-platform';

describe('data-platform batch transport', () => {
  test('batches concurrent GET requests and maps item responses', async () => {
    const fetchMock = rs.fn(
      async (input: string | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        expect(url).toBe(`http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`);
        expect(init?.method).toBe('POST');

        const payload = JSON.parse(String(init?.body)) as {
          batchId: string;
          items: Array<{ id: string; path: string }>;
        };
        expect(payload.items).toHaveLength(2);

        return new Response(
          JSON.stringify({
            protocolVersion: 1,
            batchId: payload.batchId,
            receivedAt: Date.now(),
            items: payload.items.map(item => ({
              id: item.id,
              status: 200,
              headers: {
                'content-type': 'application/json; charset=utf-8',
              },
              body: JSON.stringify({
                path: item.path,
              }),
            })),
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json; charset=utf-8',
            },
          },
        );
      },
    );

    const request = createDataBatchTransport({
      fetch: fetchMock,
      flushIntervalMs: 1,
      maxBatchSize: 8,
    });

    const [a, b] = await Promise.all([
      request('http://localhost/api/a', {
        method: 'GET',
      }),
      request('http://localhost/api/b?x=1', {
        method: 'GET',
      }),
    ]);

    expect(a).toEqual({
      path: '/api/a',
    });
    expect(b).toEqual({
      path: '/api/b?x=1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('flushes requests queued while same endpoint batch is in flight', async () => {
    let releaseFirstBatch!: () => void;
    let holdFirstBatch = true;

    const fetchMock = rs.fn(
      async (input: string | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        expect(url).toBe(`http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`);

        const payload = JSON.parse(String(init?.body)) as {
          batchId: string;
          items: Array<{ id: string; path: string }>;
        };

        if (holdFirstBatch) {
          holdFirstBatch = false;
          await new Promise<void>(resolve => {
            releaseFirstBatch = resolve;
          });
        }

        return new Response(
          JSON.stringify({
            protocolVersion: 1,
            batchId: payload.batchId,
            receivedAt: Date.now(),
            items: payload.items.map(item => ({
              id: item.id,
              status: 200,
              headers: {
                'content-type': 'application/json; charset=utf-8',
              },
              body: JSON.stringify({
                path: item.path,
              }),
            })),
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json; charset=utf-8',
            },
          },
        );
      },
    );

    const request = createDataBatchTransport({
      fetch: fetchMock,
      flushIntervalMs: 1,
      maxBatchSize: 2,
    });

    const firstBatch = Promise.all([
      request('http://localhost/api/in-flight-a', { method: 'GET' }),
      request('http://localhost/api/in-flight-b', { method: 'GET' }),
    ]);
    const queuedDuringFlush = Promise.all([
      request('http://localhost/api/queued-a', { method: 'GET' }),
      request('http://localhost/api/queued-b', { method: 'GET' }),
    ]);

    await new Promise(resolve => setTimeout(resolve, 5));
    releaseFirstBatch();
    await firstBatch;

    const result = await Promise.race([
      queuedDuringFlush,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('queued requests did not flush')),
          50,
        ),
      ),
    ]);

    expect(result).toEqual([
      {
        path: '/api/queued-a',
      },
      {
        path: '/api/queued-b',
      },
    ]);
  });

  test('keeps response demux stable when generated item ids collide', async () => {
    const originalNow = Date.now;
    const originalRandom = Math.random;
    Date.now = () => 1;
    Math.random = () => 0.5;

    try {
      const fetchMock = rs.fn(
        async (input: string | URL, init?: RequestInit): Promise<Response> => {
          const url = String(input);
          expect(url).toBe(`http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`);

          const payload = JSON.parse(String(init?.body)) as {
            batchId: string;
            items: Array<{ id: string; path: string }>;
          };
          expect(payload.items).toHaveLength(2);

          return new Response(
            JSON.stringify({
              protocolVersion: 1,
              batchId: payload.batchId,
              receivedAt: Date.now(),
              items: payload.items.map((item, index) => ({
                id: item.id,
                status: 200,
                headers: {
                  'content-type': 'application/json; charset=utf-8',
                },
                body: JSON.stringify({
                  index,
                  path: item.path,
                }),
              })),
            }),
            {
              status: 200,
              headers: {
                'content-type': 'application/json; charset=utf-8',
              },
            },
          );
        },
      );

      const request = createDataBatchTransport({
        fetch: fetchMock,
        flushIntervalMs: 1,
        maxBatchSize: 8,
      });

      const [a, b] = await Promise.all([
        request('http://localhost/api/collide-a', { method: 'GET' }),
        request('http://localhost/api/collide-b', { method: 'GET' }),
      ]);

      expect(a).toEqual({
        index: 0,
        path: '/api/collide-a',
      });
      expect(b).toEqual({
        index: 1,
        path: '/api/collide-b',
      });
    } finally {
      Date.now = originalNow;
      Math.random = originalRandom;
    }
  });

  test('dedupes identical in-flight requests', async () => {
    const fetchMock = rs.fn(
      async (input: string | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        expect(url).toBe('http://localhost/api/dedupe');
        expect(init?.method).toBe('GET');

        return new Response(
          JSON.stringify({
            value: 'same-result',
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json; charset=utf-8',
            },
          },
        );
      },
    );

    const request = createDataBatchTransport({
      fetch: fetchMock,
      flushIntervalMs: 1,
    });

    const [first, second] = await Promise.all([
      request('http://localhost/api/dedupe', {
        method: 'GET',
      }),
      request('http://localhost/api/dedupe', {
        method: 'GET',
      }),
    ]);

    expect(first).toEqual({
      value: 'same-result',
    });
    expect(second).toEqual({
      value: 'same-result',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('falls back to single requests when batch endpoint is unavailable', async () => {
    const fetchMock = rs.fn(async (input: string | URL): Promise<Response> => {
      const url = String(input);
      if (url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
        return new Response('not found', {
          status: 404,
          headers: {
            'content-type': 'text/plain',
          },
        });
      }

      return new Response(
        JSON.stringify({
          url,
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
        },
      );
    });

    const request = createDataBatchTransport({
      fetch: fetchMock,
      flushIntervalMs: 1,
    });

    const [first, second] = await Promise.all([
      request('http://localhost/api/fallback-a', {
        method: 'GET',
      }),
      request('http://localhost/api/fallback-b', {
        method: 'GET',
      }),
    ]);

    expect(first).toEqual({
      url: 'http://localhost/api/fallback-a',
    });
    expect(second).toEqual({
      url: 'http://localhost/api/fallback-b',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const third = await request('http://localhost/api/fallback-c', {
      method: 'GET',
    });
    expect(third).toEqual({
      url: 'http://localhost/api/fallback-c',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test('bypasses batching for non-GET requests', async () => {
    const fetchMock = rs.fn(
      async (input: string | URL, init?: RequestInit): Promise<Response> => {
        return new Response(
          JSON.stringify({
            url: String(input),
            method: init?.method,
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json; charset=utf-8',
            },
          },
        );
      },
    );

    const request = createDataBatchTransport({
      fetch: fetchMock,
      flushIntervalMs: 1,
    });

    const response = await request('http://localhost/api/mutation', {
      method: 'POST',
      body: JSON.stringify({
        value: 1,
      }),
      headers: {
        'content-type': 'application/json',
      },
    });

    expect(response).toEqual({
      url: 'http://localhost/api/mutation',
      method: 'POST',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'http://localhost/api/mutation',
    );
  });

  test('partitions batches by origin for micro-frontend safety', async () => {
    const batchCalls: Array<{
      endpoint: string;
      itemCount: number;
    }> = [];

    const fetchMock = rs.fn(
      async (input: string | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        if (url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
          const payload = JSON.parse(String(init?.body)) as {
            batchId: string;
            items: Array<{ id: string; path: string }>;
          };
          batchCalls.push({
            endpoint: url,
            itemCount: payload.items.length,
          });

          return new Response(
            JSON.stringify({
              protocolVersion: 1,
              batchId: payload.batchId,
              receivedAt: Date.now(),
              items: payload.items.map(item => ({
                id: item.id,
                status: 200,
                headers: {
                  'content-type': 'application/json; charset=utf-8',
                },
                body: JSON.stringify({
                  endpoint: url,
                  path: item.path,
                }),
              })),
            }),
            {
              status: 200,
              headers: {
                'content-type': 'application/json; charset=utf-8',
              },
            },
          );
        }

        throw new Error(`Unexpected non-batch request: ${url}`);
      },
    );

    const request = createDataBatchTransport({
      fetch: fetchMock,
      flushIntervalMs: 1,
      maxBatchSize: 8,
    });

    const results = await Promise.all([
      request('http://localhost:3011/host-api/a', {
        method: 'GET',
      }),
      request('http://localhost:3011/host-api/b', {
        method: 'GET',
      }),
      request('http://localhost:3010/remote-api/a', {
        method: 'GET',
      }),
      request('http://localhost:3010/remote-api/b', {
        method: 'GET',
      }),
    ]);

    expect(results).toHaveLength(4);
    expect(batchCalls).toEqual(
      expect.arrayContaining([
        {
          endpoint: 'http://localhost:3011/_data/batch',
          itemCount: 2,
        },
        {
          endpoint: 'http://localhost:3010/_data/batch',
          itemCount: 2,
        },
      ]),
    );
    expect(batchCalls).toHaveLength(2);
  });
});
