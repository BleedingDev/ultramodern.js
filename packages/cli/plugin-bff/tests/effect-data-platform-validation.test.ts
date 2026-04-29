import {
  createRequestEnvelope,
  DEFAULT_DATA_ENVELOPE_HEADER,
  encodeRequestEnvelopeHeader,
} from '../src/runtime/data-platform';
import {
  createHttpApiHandler,
  Effect,
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  Layer,
  Schema,
} from '../src/runtime/effect';

describe('effect runtime data-platform validation', () => {
  const api = HttpApi.make('TestEffectApi').add(
    HttpApiGroup.make('greetings')
      .add(
        HttpApiEndpoint.get('ping', '/ping', {
          success: Schema.Struct({
            ok: Schema.Boolean,
          }),
        }),
      )
      .add(
        HttpApiEndpoint.get('traceHeader', '/trace-header', {
          headers: {
            traceparent: Schema.optional(Schema.String),
          },
          success: Schema.Struct({
            traceparent: Schema.optional(Schema.String),
          }),
        }),
      ),
  );

  const groupLayer = HttpApiBuilder.group(api, 'greetings', handlers =>
    handlers
      .handle('ping', () =>
        Effect.succeed({
          ok: true,
        }),
      )
      .handle('traceHeader', ({ headers }) =>
        Effect.succeed({
          traceparent: headers.traceparent,
        }),
      ),
  );

  const layer = HttpApiBuilder.layer(api).pipe(Layer.provide(groupLayer));

  const createEnvelope = (input: {
    endpoint: string;
    routePath: string;
    appNamespace?: string;
    origin?: string;
    traceContext?: {
      traceId: string;
      spanId: string;
      sampled: boolean;
    };
  }) =>
    createRequestEnvelope({
      operation: {
        appNamespace: input.appNamespace || 'test-app',
        apiId: 'TestEffectApi',
        group: 'greetings',
        endpoint: input.endpoint,
      },
      scope: {
        appNamespace: input.appNamespace || 'test-app',
        origin: input.origin || 'http://localhost',
      },
      requestInput: {
        method: 'GET',
        routePath: input.routePath,
      },
      requestMode: 'cache-first',
      traceContext: input.traceContext,
    });

  test('rejects request when envelope is required but missing', async () => {
    const handler = createHttpApiHandler({
      api,
      layer,
      dataPlatform: {
        requireEnvelope: true,
      },
    });

    const response = await handler.handler(
      new Request('http://localhost/ping'),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        message: expect.stringContaining(
          'Missing required data envelope header',
        ),
      }),
    );

    await handler.dispose();
  });

  test('accepts valid envelope and reaches effect endpoint', async () => {
    const handler = createHttpApiHandler({
      api,
      layer,
      dataPlatform: {
        requireEnvelope: true,
        expectedNamespace: 'test-app',
      },
    });

    const envelope = createRequestEnvelope({
      operation: {
        appNamespace: 'test-app',
        apiId: 'TestEffectApi',
        group: 'greetings',
        endpoint: 'ping',
      },
      scope: {
        appNamespace: 'test-app',
        origin: 'http://localhost',
      },
      requestInput: {
        method: 'GET',
        routePath: '/ping',
      },
      requestMode: 'cache-first',
    });

    const request = new Request('http://localhost/ping', {
      headers: {
        [DEFAULT_DATA_ENVELOPE_HEADER]: encodeRequestEnvelopeHeader(envelope),
      },
    });

    const response = await handler.handler(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    await handler.dispose();
  });

  test('rejects envelope when namespace does not match expected namespace', async () => {
    const handler = createHttpApiHandler({
      api,
      layer,
      dataPlatform: {
        requireEnvelope: true,
        expectedNamespace: 'host-app',
      },
    });

    const envelope = createRequestEnvelope({
      operation: {
        appNamespace: 'remote-app',
        apiId: 'TestEffectApi',
        group: 'greetings',
        endpoint: 'ping',
      },
      scope: {
        appNamespace: 'remote-app',
        origin: 'http://localhost',
      },
      requestInput: {
        method: 'GET',
        routePath: '/ping',
      },
      requestMode: 'cache-first',
    });

    const request = new Request('http://localhost/ping', {
      headers: {
        [DEFAULT_DATA_ENVELOPE_HEADER]: encodeRequestEnvelopeHeader(envelope),
      },
    });

    const response = await handler.handler(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        message: 'Invalid data envelope',
        errors: expect.arrayContaining([
          expect.stringContaining('Namespace mismatch'),
        ]),
      }),
    );

    await handler.dispose();
  });

  test('accepts envelope when scope origin matches request Origin header', async () => {
    const handler = createHttpApiHandler({
      api,
      layer,
      dataPlatform: {
        requireEnvelope: true,
        expectedNamespace: 'test-app',
      },
    });

    const envelope = createRequestEnvelope({
      operation: {
        appNamespace: 'test-app',
        apiId: 'TestEffectApi',
        group: 'greetings',
        endpoint: 'ping',
      },
      scope: {
        appNamespace: 'test-app',
        origin: 'http://localhost:4000',
      },
      requestInput: {
        method: 'GET',
        routePath: '/ping',
      },
      requestMode: 'cache-first',
    });

    const request = new Request('http://127.0.0.1:3399/ping', {
      headers: {
        origin: 'http://localhost:4000',
        [DEFAULT_DATA_ENVELOPE_HEADER]: encodeRequestEnvelopeHeader(envelope),
      },
    });

    const response = await handler.handler(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    await handler.dispose();
  });

  test('rejects envelope when scope origin does not match request Origin header', async () => {
    const handler = createHttpApiHandler({
      api,
      layer,
      dataPlatform: {
        requireEnvelope: true,
      },
    });

    const envelope = createRequestEnvelope({
      operation: {
        appNamespace: 'test-app',
        apiId: 'TestEffectApi',
        group: 'greetings',
        endpoint: 'ping',
      },
      scope: {
        appNamespace: 'test-app',
        origin: 'http://localhost:4000',
      },
      requestInput: {
        method: 'GET',
        routePath: '/ping',
      },
      requestMode: 'cache-first',
    });

    const request = new Request('http://127.0.0.1:3399/ping', {
      headers: {
        origin: 'http://localhost:5000',
        [DEFAULT_DATA_ENVELOPE_HEADER]: encodeRequestEnvelopeHeader(envelope),
      },
    });

    const response = await handler.handler(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        message: 'Invalid data envelope',
        errors: expect.arrayContaining([
          expect.stringContaining('Origin mismatch'),
        ]),
      }),
    );

    await handler.dispose();
  });

  test('executes batch gateway with per-item envelope validation', async () => {
    const handler = createHttpApiHandler({
      api,
      layer,
      dataPlatform: {
        requireEnvelope: true,
        expectedNamespace: 'test-app',
        batch: {
          enabled: true,
          maxBatchSize: 8,
          maxConcurrency: 2,
        },
      },
    });

    const traceEnvelope = createEnvelope({
      endpoint: 'traceHeader',
      routePath: '/trace-header',
      traceContext: {
        traceId: '11111111111111111111111111111111',
        spanId: '2222222222222222',
        sampled: true,
      },
    });

    const payload = {
      protocolVersion: 1,
      batchId: 'batch-1',
      sentAt: Date.now(),
      items: [
        {
          id: 'ping-1',
          path: '/ping',
          method: 'GET',
          headers: {
            [DEFAULT_DATA_ENVELOPE_HEADER]: encodeRequestEnvelopeHeader(
              createEnvelope({
                endpoint: 'ping',
                routePath: '/ping',
              }),
            ),
          },
        },
        {
          id: 'trace-1',
          path: '/trace-header',
          method: 'GET',
          headers: {
            [DEFAULT_DATA_ENVELOPE_HEADER]:
              encodeRequestEnvelopeHeader(traceEnvelope),
          },
        },
      ],
    };

    const response = await handler.handler(
      new Request('http://localhost/_data/batch', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      batchId: string;
      items: Array<{
        id: string;
        status: number;
        body?: string;
      }>;
    };
    expect(json.batchId).toBe('batch-1');
    expect(json.items).toHaveLength(2);

    const pingItem = json.items.find(item => item.id === 'ping-1');
    const traceItem = json.items.find(item => item.id === 'trace-1');

    expect(pingItem?.status).toBe(200);
    expect(traceItem?.status).toBe(200);
    expect(
      JSON.parse(String(pingItem?.body)) as {
        ok: boolean;
      },
    ).toEqual({
      ok: true,
    });
    expect(
      JSON.parse(String(traceItem?.body)) as {
        traceparent?: string;
      },
    ).toEqual({
      traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
    });

    await handler.dispose();
  });

  test('normalizes prefixed batch item paths using mounted context path', async () => {
    const handler = createHttpApiHandler({
      api,
      layer,
      dataPlatform: {
        requireEnvelope: true,
        expectedNamespace: 'test-app',
        batch: {
          enabled: true,
          maxBatchSize: 8,
        },
      },
    });

    const payload = {
      protocolVersion: 1,
      batchId: 'batch-prefixed',
      sentAt: Date.now(),
      items: [
        {
          id: 'ping-prefixed',
          path: '/bff-api/ping',
          method: 'GET',
          headers: {
            [DEFAULT_DATA_ENVELOPE_HEADER]: encodeRequestEnvelopeHeader(
              createEnvelope({
                endpoint: 'ping',
                routePath: '/ping',
              }),
            ),
          },
        },
      ],
    };

    const response = await handler.handler(
      new Request('http://localhost/_data/batch', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      }),
      {
        path: '/bff-api/_data/batch',
        method: 'POST',
        env: {},
      } as unknown as Parameters<typeof handler.handler>[1],
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      items: Array<{
        id: string;
        status: number;
        body?: string;
      }>;
    };
    expect(json.items).toHaveLength(1);
    expect(json.items[0]?.id).toBe('ping-prefixed');
    expect(json.items[0]?.status).toBe(200);
    expect(
      JSON.parse(String(json.items[0]?.body)) as {
        ok: boolean;
      },
    ).toEqual({
      ok: true,
    });

    await handler.dispose();
  });

  test('returns per-item error for missing envelope when batch requires envelope', async () => {
    const handler = createHttpApiHandler({
      api,
      layer,
      dataPlatform: {
        requireEnvelope: true,
        batch: {
          enabled: true,
        },
      },
    });

    const payload = {
      protocolVersion: 1,
      batchId: 'batch-2',
      sentAt: Date.now(),
      items: [
        {
          id: 'missing-envelope',
          path: '/ping',
          method: 'GET',
        },
      ],
    };

    const response = await handler.handler(
      new Request('http://localhost/_data/batch', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      items: Array<{
        id: string;
        status: number;
        body?: string;
      }>;
    };

    expect(json.items).toHaveLength(1);
    expect(json.items[0]?.id).toBe('missing-envelope');
    expect(json.items[0]?.status).toBe(400);
    expect(String(json.items[0]?.body || '')).toContain(
      'Missing required data envelope header',
    );

    await handler.dispose();
  });

  test('disables batch gateway when configured', async () => {
    const handler = createHttpApiHandler({
      api,
      layer,
      dataPlatform: {
        batch: {
          enabled: false,
        },
      },
    });

    const response = await handler.handler(
      new Request('http://localhost/_data/batch', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          protocolVersion: 1,
          batchId: 'batch-disabled',
          sentAt: Date.now(),
          items: [],
        }),
      }),
    );

    expect(response.status).toBe(404);

    await handler.dispose();
  });
});
