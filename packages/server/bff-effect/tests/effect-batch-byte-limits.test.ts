import {
  createDataBatchTransport,
  type DataBatchRequestPayload,
  DEFAULT_DATA_BATCH_ENDPOINT,
  DEFAULT_DATA_BATCH_HEADER,
} from '../src/data-platform';
import { createDataPlatformBatchRequestHandler } from '../src/effect/handler/batch-handler';

const FIXED_NOW = 1_700_000_000_000;
const FIXED_RANDOM = 0.5;
const MAX_BATCH_BYTES = 1_024;

const expectedItemId = (index: number) =>
  `${FIXED_NOW.toString(36)}_${index.toString(36)}_${FIXED_RANDOM.toString(16).slice(2, 8)}`;

const expectedBatchId = () =>
  `batch_${FIXED_NOW.toString(36)}_${FIXED_RANDOM.toString(16).slice(2, 10)}`;

const expectedPayloadBytes = (paths: string[]) =>
  new TextEncoder().encode(
    JSON.stringify({
      protocolVersion: 2,
      batchId: expectedBatchId(),
      sentAt: FIXED_NOW,
      items: paths.map((path, index) => ({
        id: expectedItemId(index),
        path,
        method: 'GET',
        headers: {},
      })),
    }),
  ).byteLength;

const findSecondPathAtWireSize = (target: number) => {
  const firstPath = '/a';
  const emptySecond = '/b';
  const baseSize = expectedPayloadBytes([firstPath, emptySecond]);
  return {
    firstPath,
    secondPath: `${emptySecond}${'x'.repeat(target - baseSize)}`,
  };
};

describe('Effect batch byte limits', () => {
  beforeEach(() => {
    rs.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    rs.spyOn(Math, 'random').mockReturnValue(FIXED_RANDOM);
  });

  afterEach(() => {
    rs.restoreAllMocks();
  });

  test('admits an exact-limit payload and splits before appending the plus-one item', async () => {
    const exact = findSecondPathAtWireSize(MAX_BATCH_BYTES);
    expect(expectedPayloadBytes([exact.firstPath, exact.secondPath])).toBe(
      MAX_BATCH_BYTES,
    );

    const calls: Array<{ url: string; payload?: DataBatchRequestPayload }> = [];
    const createTransport = () =>
      createDataBatchTransport({
        flushIntervalMs: 0,
        maxBatchBytes: MAX_BATCH_BYTES,
        maxBatchSize: 8,
        fetch: async (input, init) => {
          const url = String(input);
          if (new URL(url).pathname !== DEFAULT_DATA_BATCH_ENDPOINT) {
            calls.push({ url });
            return Response.json({ path: new URL(url).pathname });
          }
          expect(
            new Headers(init?.headers).get(DEFAULT_DATA_BATCH_HEADER),
          ).toBe('2');
          const payload = JSON.parse(
            String(init?.body),
          ) as DataBatchRequestPayload;
          calls.push({ url, payload });
          return Response.json({
            protocolVersion: 2,
            batchId: payload.batchId,
            receivedAt: FIXED_NOW,
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
        },
      });

    const exactTransport = createTransport();
    await expect(
      Promise.all([
        exactTransport(`http://localhost${exact.firstPath}`),
        exactTransport(`http://localhost${exact.secondPath}`),
      ]),
    ).resolves.toEqual([{ path: exact.firstPath }, { path: exact.secondPath }]);
    expect(calls).toHaveLength(1);
    expect(
      new TextEncoder().encode(JSON.stringify(calls[0]?.payload)).byteLength,
    ).toBe(MAX_BATCH_BYTES);

    calls.length = 0;
    const plusOneTransport = createTransport();
    await Promise.all([
      plusOneTransport(`http://localhost${exact.firstPath}`),
      plusOneTransport(`http://localhost${exact.secondPath}x`),
    ]);
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.payload === undefined)).toBe(true);
  });

  test('falls back an oversized mutation exactly once without placing it in a batch', async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const transport = createDataBatchTransport({
      allowedMethods: ['POST'],
      flushIntervalMs: 1_000,
      maxBatchBytes: MAX_BATCH_BYTES,
      fetch: async (input, init) => {
        calls.push({
          url: String(input),
          method: init?.method || 'GET',
          body: String(init?.body || ''),
        });
        return Response.json({ accepted: true });
      },
    });

    await expect(
      transport('http://localhost/mutate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: 'x'.repeat(MAX_BATCH_BYTES) }),
      }),
    ).resolves.toEqual({ accepted: true });

    expect(calls).toEqual([
      {
        url: 'http://localhost/mutate',
        method: 'POST',
        body: JSON.stringify({ value: 'x'.repeat(MAX_BATCH_BYTES) }),
      },
    ]);
  });

  test('accepts the exact server limit and rejects plus one', async () => {
    const handler = createDataPlatformBatchRequestHandler({
      dataPlatform: { batch: { maxBatchBytes: MAX_BATCH_BYTES } },
      handleItem: async () => Response.json({ ok: true }),
    });
    const makePayload = (size: number) => {
      const base = JSON.stringify({
        protocolVersion: 2,
        batchId: 'batch-limit',
        sentAt: FIXED_NOW,
        items: [{ id: 'a', path: '/', method: 'GET' }],
      });
      const insertion = 'x'.repeat(
        size - new TextEncoder().encode(base).length,
      );
      return base.replace('"path":"/"', `"path":"/${insertion}"`);
    };
    const exact = makePayload(MAX_BATCH_BYTES);
    const plusOne = `${exact} `;
    expect(new TextEncoder().encode(exact)).toHaveLength(MAX_BATCH_BYTES);
    expect(new TextEncoder().encode(plusOne)).toHaveLength(MAX_BATCH_BYTES + 1);

    const exactResponse = await handler.handle(
      new Request('http://localhost/_data/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: exact,
      }),
    );
    const plusOneResponse = await handler.handle(
      new Request('http://localhost/_data/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: plusOne,
      }),
    );

    expect(exactResponse.status).toBe(200);
    expect(plusOneResponse.status).toBe(413);
  });

  test('fast-rejects declared oversize and cancels streaming input after the cap', async () => {
    let declaredPulls = 0;
    const declaredBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([123]));
      },
      pull(controller) {
        declaredPulls += 1;
        controller.enqueue(new Uint8Array([123]));
      },
    });
    const handler = createDataPlatformBatchRequestHandler({
      dataPlatform: { batch: { maxBatchBytes: MAX_BATCH_BYTES } },
      handleItem: async () => Response.json({ ok: true }),
    });
    const declaredInit: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      duplex: 'half',
      headers: {
        'content-length': String(MAX_BATCH_BYTES + 1),
        'content-type': 'application/json',
      },
      body: declaredBody,
    };
    const declaredRequest = new Request(
      'http://localhost/_data/batch',
      declaredInit,
    );
    const declaredResponse = await handler.handle(declaredRequest);
    expect(declaredResponse.status).toBe(413);
    expect(declaredPulls).toBe(0);

    let streamedPulls = 0;
    let cancelled = false;
    const streamedBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        streamedPulls += 1;
        controller.enqueue(new Uint8Array(600).fill(120));
      },
      cancel() {
        cancelled = true;
      },
    });
    const streamedInit: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      duplex: 'half',
      headers: { 'content-type': 'application/json' },
      body: streamedBody,
    };
    const streamedResponse = await handler.handle(
      new Request('http://localhost/_data/batch', streamedInit),
    );
    expect(streamedResponse.status).toBe(413);
    expect(streamedPulls).toBe(2);
    expect(cancelled).toBe(true);
  });
});
