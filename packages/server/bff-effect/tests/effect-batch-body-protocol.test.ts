import {
  createDataBatchTransport,
  type DataBatchRequestPayload,
  DEFAULT_DATA_BATCH_ENDPOINT,
} from '../src/data-platform';
import { isBatchResponsePayload } from '../src/data-platform/batch/response';
import { createDataPlatformBatchRequestHandler } from '../src/effect/handler/batch-handler';

const createLoopbackTransport = (
  handleItem: (request: Request) => Promise<Response>,
  requestCount: number,
) => {
  const handler = createDataPlatformBatchRequestHandler({
    dataPlatform: {
      batch: {
        allowedMethods: ['GET', 'POST'],
        maxBatchSize: requestCount,
      },
    },
    handleItem,
  });

  return createDataBatchTransport({
    allowedMethods: ['GET', 'POST'],
    flushIntervalMs: 1_000,
    maxBatchSize: requestCount,
    fetch: async (input, init) => {
      const request = new Request(String(input), init);
      if (new URL(request.url).pathname === DEFAULT_DATA_BATCH_ENDPOINT) {
        return handler.handle(request);
      }
      return handleItem(request);
    },
  });
};

describe('Effect batch body protocol', () => {
  test('round-trips binary, UTF-8, JSON, and FormData bodies without text coercion', async () => {
    const transport = createLoopbackTransport(async request => {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/binary') {
        return new Response(new Uint8Array([0, 255, 1, 128]), {
          headers: { 'content-type': 'application/octet-stream' },
        });
      }
      if (pathname === '/utf8') {
        return new Response('雪☃️café', {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
      if (pathname === '/json') {
        return Response.json({ ok: true, value: '雪' });
      }
      if (pathname === '/echo-json') {
        return Response.json(await request.json());
      }
      if (pathname === '/echo-form') {
        const form = await request.formData();
        return Response.json({
          value: form.get('value'),
          unicode: form.get('unicode'),
        });
      }
      throw new Error(`Unexpected path: ${pathname}`);
    }, 5);

    const form = new FormData();
    form.set('value', 'alpha');
    form.set('unicode', '雪');

    const [binary, utf8, json, echoedJson, echoedForm] = await Promise.all([
      transport('http://localhost/binary'),
      transport('http://localhost/utf8'),
      transport('http://localhost/json'),
      transport('http://localhost/echo-json', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 7, label: '雪' }),
      }),
      transport('http://localhost/echo-form', {
        method: 'POST',
        body: form,
      }),
    ]);

    expect([...new Uint8Array(binary as ArrayBuffer)]).toEqual([
      0, 255, 1, 128,
    ]);
    expect(utf8).toBe('雪☃️café');
    expect(json).toEqual({ ok: true, value: '雪' });
    expect(echoedJson).toEqual({ id: 7, label: '雪' });
    expect(echoedForm).toEqual({ value: 'alpha', unicode: '雪' });
  });

  test('represents null-body statuses without constructing forbidden bodies', async () => {
    const transport = createLoopbackTransport(async request => {
      const pathname = new URL(request.url).pathname;
      const status =
        pathname === '/no-content'
          ? 204
          : pathname === '/reset-content'
            ? 205
            : 304;
      return new Response(null, { status });
    }, 3);

    const [noContent, resetContent, notModified] = await Promise.allSettled([
      transport('http://localhost/no-content'),
      transport('http://localhost/reset-content'),
      transport('http://localhost/not-modified'),
    ]);

    expect(noContent).toEqual({ status: 'fulfilled', value: '' });
    expect(resetContent).toEqual({ status: 'fulfilled', value: '' });
    expect(notModified.status).toBe('rejected');
    if (notModified.status === 'rejected') {
      expect(notModified.reason).toBeInstanceOf(Response);
      expect((notModified.reason as Response).status).toBe(304);
      expect((notModified.reason as Response & { data?: unknown }).data).toBe(
        '',
      );
    }
  });

  test('drops cookie and transport headers while preserving repeatable end-to-end headers', async () => {
    const transport = createLoopbackTransport(async () => {
      const headers = new Headers({
        connection: 'x-private-hop',
        'content-length': '999',
        'content-type': 'image/png',
        'x-private-hop': 'secret-hop',
      });
      headers.append('link', '</a>; rel=preload');
      headers.append('link', '</b>; rel=preload');
      headers.append('set-cookie', 'session=secret; HttpOnly');
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers });
    }, 2);

    const [first, second] = await Promise.all([
      transport('http://localhost/image-a'),
      transport('http://localhost/image-b'),
    ]);

    for (const value of [first, second]) {
      expect(value).toBeInstanceOf(Response);
      const response = value as Response;
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(response.headers.get('connection')).toBeNull();
      expect(response.headers.get('content-length')).toBeNull();
      expect(response.headers.get('x-private-hop')).toBeNull();
      expect(response.headers.get('link')).toBe(
        '</a>; rel=preload, </b>; rel=preload',
      );
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
        137, 80, 78, 71,
      ]);
    }
  });

  test('rejects malformed or non-canonical base64 per item without dispatch', async () => {
    const handleItem = rs.fn(async () => Response.json({ unreachable: true }));
    const handler = createDataPlatformBatchRequestHandler({
      dataPlatform: { batch: { allowedMethods: ['POST'] } },
      handleItem,
    });
    const response = await handler.handle(
      new Request('http://localhost/_data/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          protocolVersion: 2,
          batchId: 'batch-invalid-body',
          sentAt: 1_700_000_000_000,
          items: [
            ['invalid-characters', '%%%not-base64%%%'],
            ['non-zero-four-pad-bits', 'AB=='],
            ['non-zero-two-pad-bits', 'AAB='],
          ].map(([id, data]) => ({
            id,
            path: '/mutate',
            method: 'POST',
            body: { encoding: 'base64', data },
          })),
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-modernjs-data-batch')).toBe('2');
    expect(handleItem).not.toHaveBeenCalled();
    expect(payload.items).toEqual([
      expect.objectContaining({ id: 'invalid-characters', status: 400 }),
      expect.objectContaining({ id: 'non-zero-four-pad-bits', status: 400 }),
      expect.objectContaining({ id: 'non-zero-two-pad-bits', status: 400 }),
    ]);
  });

  test('rejects v1 and legacy body shapes without dispatch or object coercion', async () => {
    const handleItem = rs.fn(async () => Response.json({ unreachable: true }));
    const handler = createDataPlatformBatchRequestHandler({
      dataPlatform: { batch: { allowedMethods: ['POST'] } },
      handleItem,
    });
    const createRequest = (payload: unknown) =>
      new Request('http://localhost/_data/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    const v1Response = await handler.handle(
      createRequest({
        protocolVersion: 1,
        batchId: 'legacy-v1',
        sentAt: 1_700_000_000_000,
        items: [{ id: 'legacy', path: '/mutate', method: 'POST' }],
      }),
    );
    const mismatchedResponse = await handler.handle(
      createRequest({
        protocolVersion: 2,
        batchId: 'legacy-body',
        sentAt: 1_700_000_000_000,
        items: [
          {
            id: 'legacy',
            path: '/mutate',
            method: 'POST',
            body: '[object Object]',
          },
        ],
      }),
    );
    const v1Text = await v1Response.text();
    const mismatchedText = await mismatchedResponse.text();

    expect(v1Response.status).toBe(400);
    expect(v1Text).not.toContain('[object Object]');
    expect(mismatchedResponse.status).toBe(200);
    expect(mismatchedText).not.toContain('[object Object]');
    expect(handleItem).not.toHaveBeenCalled();
  });

  test('accepts only protocol-v2 response payloads', () => {
    const payload = {
      batchId: 'batch-response-version',
      receivedAt: 1_700_000_000_000,
      items: [{ id: 'item', status: 204, headers: [] }],
    };

    expect(isBatchResponsePayload({ ...payload, protocolVersion: 2 })).toBe(
      true,
    );
    expect(isBatchResponsePayload({ ...payload, protocolVersion: 1 })).toBe(
      false,
    );
    expect(
      isBatchResponsePayload({
        ...payload,
        protocolVersion: 2,
        items: [
          {
            id: 'legacy-headers',
            status: 200,
            headers: { 'content-type': 'text/plain' },
          },
        ],
      }),
    ).toBe(false);
    expect(
      isBatchResponsePayload({
        ...payload,
        protocolVersion: 2,
        items: [{ id: 'legacy-body', status: 200, body: '[object Object]' }],
      }),
    ).toBe(false);
  });

  test('rejects a mismatched response batch id before mapping items', async () => {
    const calls: string[] = [];
    const transport = createDataBatchTransport({
      allowedMethods: ['GET', 'POST'],
      flushIntervalMs: 1_000,
      maxBatchSize: 2,
      fetch: async (input, init) => {
        const url = String(input);
        calls.push(`${init?.method || 'GET'} ${url}`);
        if (url.endsWith(DEFAULT_DATA_BATCH_ENDPOINT)) {
          const requestPayload = JSON.parse(
            String(init?.body),
          ) as DataBatchRequestPayload;
          return Response.json({
            protocolVersion: 2,
            batchId: 'different-batch',
            receivedAt: Date.now(),
            items: requestPayload.items.map(item => ({
              id: item.id,
              status: 200,
              headers: [['content-type', 'application/json']],
              body: {
                encoding: 'base64',
                data: btoa(JSON.stringify({ mapped: true })),
              },
            })),
          });
        }
        return Response.json({ replayed: new URL(url).pathname });
      },
    });

    const outcomes = await Promise.allSettled([
      transport('http://localhost/read'),
      transport('http://localhost/mutate', { method: 'POST' }),
    ]);

    expect(outcomes[0]).toEqual({
      status: 'fulfilled',
      value: { replayed: '/read' },
    });
    expect(outcomes[1]).toEqual({
      status: 'rejected',
      reason: expect.objectContaining({
        message: expect.stringContaining('mismatched-batch-id'),
      }),
    });
    expect(calls).toEqual([
      `POST http://localhost${DEFAULT_DATA_BATCH_ENDPOINT}`,
      'GET http://localhost/read',
    ]);
  });

  test('omits HEAD response bodies while preserving status and headers', async () => {
    const handler = createDataPlatformBatchRequestHandler({
      dataPlatform: { batch: { allowedMethods: ['HEAD'] } },
      handleItem: async () =>
        new Response('must-not-be-serialized', {
          status: 202,
          headers: {
            'content-type': 'text/plain',
            'x-head-result': 'preserved',
          },
        }),
    });
    const response = await handler.handle(
      new Request('http://localhost/_data/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          protocolVersion: 2,
          batchId: 'batch-head',
          sentAt: 1_700_000_000_000,
          items: [
            {
              id: 'head-item',
              path: '/resource',
              method: 'HEAD',
            },
          ],
        }),
      }),
    );
    const payload = await response.json();

    expect(payload.items).toEqual([
      {
        id: 'head-item',
        status: 202,
        headers: expect.arrayContaining([
          ['content-type', 'text/plain'],
          ['x-head-result', 'preserved'],
        ]),
      },
    ]);
  });
});
