import {
  createDataBatchTransport,
  type DataBatchRequestPayload,
  normalizeMethod,
  stableStringify,
} from '../src/data-platform';

describe('data-platform public codec boundaries', () => {
  test('omits undefined object fields while preserving array positions as null', () => {
    expect(
      stableStringify({
        zeta: undefined,
        list: [undefined, { zeta: undefined, alpha: 1 }],
        alpha: 'kept',
      }),
    ).toBe('{"alpha":"kept","list":[null,{"alpha":1}]}');
  });

  test.each([
    ['get', 'GET'],
    ['PaTcH', 'PATCH'],
  ])('normalizes %s to %s', (method, expected) => {
    expect(normalizeMethod(method)).toBe(expected);
  });

  test('accepts relative strings and URL objects through the public transport', async () => {
    const calls: Array<{ input: string; method: string | undefined }> = [];
    const transport = createDataBatchTransport({
      maxBatchSize: 1,
      fetch: async (input, init) => {
        calls.push({ input: String(input), method: init?.method });
        return new Response(String(input), {
          headers: { 'content-type': 'Text/Plain' },
        });
      },
    });

    await expect(transport('/relative/items?cursor=1')).resolves.toBe(
      'http://localhost/relative/items?cursor=1',
    );
    await expect(
      transport(new URL('https://url.test/items?cursor=2')),
    ).resolves.toBe('https://url.test/items?cursor=2');
    expect(calls).toEqual([
      {
        input: 'http://localhost/relative/items?cursor=1',
        method: 'GET',
      },
      {
        input: 'https://url.test/items?cursor=2',
        method: 'GET',
      },
    ]);
  });

  test.each([
    ['a path-relative', 'rpc/batch', 'https://service.test/rpc/batch'],
    ['an absolute', 'https://batch.test/collect', 'https://batch.test/collect'],
  ])('resolves %s batch endpoint through the public transport', async (_scenario, endpoint, expectedEndpoint) => {
    const batchCalls: string[] = [];
    const transport = createDataBatchTransport({
      endpoint,
      maxBatchSize: 2,
      fetch: async (input, init) => {
        batchCalls.push(String(input));
        const payload = JSON.parse(
          String(init?.body),
        ) as DataBatchRequestPayload;
        return Response.json({
          protocolVersion: 2,
          batchId: payload.batchId,
          receivedAt: 1_700_000_000_000,
          items: payload.items.map(item => ({
            id: item.id,
            status: 204,
            headers: [],
          })),
        });
      },
    });

    await expect(
      Promise.all([
        transport('https://service.test/first'),
        transport('https://service.test/second'),
      ]),
    ).resolves.toEqual(['', '']);
    expect(batchCalls).toEqual([expectedEndpoint]);
  });

  test.each([
    [
      'Application/JSON; Charset=UTF-8',
      JSON.stringify({ ok: true }),
      { ok: true },
    ],
    [
      'Text/JSON; Charset=UTF-8',
      JSON.stringify({ ok: 'text-json' }),
      { ok: 'text-json' },
    ],
    ['Text/Plain; Charset=UTF-8', 'plain body', 'plain body'],
  ])('parses case-insensitive %s responses through the public transport', async (contentType, body, expected) => {
    const transport = createDataBatchTransport({
      maxBatchSize: 1,
      fetch: async () =>
        new Response(body, {
          headers: { 'content-type': contentType },
        }),
    });

    await expect(transport('https://service.test/value')).resolves.toEqual(
      expected,
    );
  });

  test.each([
    ['missing id', (itemId: string) => ({ status: 204, originalId: itemId })],
    ['non-numeric status', (itemId: string) => ({ id: itemId, status: '204' })],
    ['missing status', (itemId: string) => ({ id: itemId })],
    [
      'malformed headers',
      (itemId: string) => ({
        id: itemId,
        status: 200,
        headers: [['content-type', 42]],
      }),
    ],
    [
      'malformed body',
      (itemId: string) => ({
        id: itemId,
        status: 200,
        body: { encoding: 'base64', data: 'not canonical base64' },
      }),
    ],
    [
      'body on a null-body status',
      (itemId: string) => ({
        id: itemId,
        status: 204,
        body: { encoding: 'base64', data: 'dW5leHBlY3RlZA==' },
      }),
    ],
  ])('rejects a protocol-v2 response item with %s and safely replays reads', async (_scenario, createInvalidItem) => {
    const calls: string[] = [];
    const transport = createDataBatchTransport({
      maxBatchSize: 2,
      fetch: async (input, init) => {
        const url = String(input);
        calls.push(url);
        if (url === 'https://service.test/_data/batch') {
          const payload = JSON.parse(
            String(init?.body),
          ) as DataBatchRequestPayload;
          const firstItem = payload.items[0];
          if (!firstItem) {
            throw new Error('Expected a batched request item');
          }
          return Response.json({
            protocolVersion: 2,
            batchId: payload.batchId,
            receivedAt: 1_700_000_000_000,
            items: [createInvalidItem(firstItem.id)],
          });
        }
        return Response.json({ replayed: new URL(url).pathname });
      },
    });

    await expect(
      Promise.all([
        transport('https://service.test/first'),
        transport('https://service.test/second'),
      ]),
    ).resolves.toEqual([{ replayed: '/first' }, { replayed: '/second' }]);
    expect(calls).toEqual([
      'https://service.test/_data/batch',
      'https://service.test/first',
      'https://service.test/second',
    ]);
  });
});
