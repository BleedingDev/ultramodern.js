import {
  createRequestEnvelope,
  type DataBatchBody,
  type DataBatchResponsePayload,
  DEFAULT_DATA_ENVELOPE_HEADER,
  encodeRequestEnvelopeHeader,
} from '@modern-js/bff-effect/data-platform';
import {
  createHttpApiHandler,
  Effect,
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  Layer,
  Schema,
} from '@modern-js/bff-effect/effect';

const api = HttpApi.make('DataPlatformEnvelopeApi').add(
  HttpApiGroup.make('greetings')
    .add(
      HttpApiEndpoint.get('ping', '/ping', {
        success: Schema.Struct({ ok: Schema.Boolean }),
      }),
    )
    .add(
      HttpApiEndpoint.get('traceHeader', '/trace-header', {
        headers: { traceparent: Schema.String },
        success: Schema.Struct({ traceparent: Schema.String }),
      }),
    ),
);

const groupLayer = HttpApiBuilder.group(api, 'greetings', handlers =>
  handlers
    .handle('ping', () => Effect.succeed({ ok: true }))
    .handle('traceHeader', ({ headers }) =>
      Effect.succeed({ traceparent: headers.traceparent }),
    ),
);

const layer = HttpApiBuilder.layer(api).pipe(Layer.provide(groupLayer));

const createEnvelopeHeader = (input: {
  endpoint: 'ping' | 'traceHeader';
  routePath: '/ping' | '/trace-header';
  namespace?: string;
  origin?: string;
  traceContext?: {
    traceId: string;
    spanId: string;
    sampled: boolean;
  };
}) =>
  encodeRequestEnvelopeHeader(
    createRequestEnvelope({
      operation: {
        appNamespace: input.namespace ?? 'test-app',
        apiId: 'DataPlatformEnvelopeApi',
        group: 'greetings',
        endpoint: input.endpoint,
      },
      scope: {
        appNamespace: input.namespace ?? 'test-app',
        origin: input.origin ?? 'http://localhost',
      },
      requestInput: {
        method: 'GET',
        routePath: input.routePath,
      },
      requestMode: 'cache-first',
      traceContext: input.traceContext,
    }),
  );

const decodeBody = (body?: DataBatchBody) =>
  body ? Buffer.from(body.data, 'base64').toString('utf8') : '';

describe('Effect data-platform envelope integration', () => {
  test('dispatches a valid envelope and rejects namespace and origin mismatches', async () => {
    const handler = createHttpApiHandler({
      api,
      layer,
      dataPlatform: {
        requireEnvelope: true,
        expectedNamespace: 'test-app',
      },
    });

    try {
      const validResponse = await handler.handler(
        new Request('http://127.0.0.1:3399/ping', {
          headers: {
            origin: 'http://allowed.test',
            [DEFAULT_DATA_ENVELOPE_HEADER]: createEnvelopeHeader({
              endpoint: 'ping',
              routePath: '/ping',
              origin: 'http://allowed.test',
            }),
          },
        }),
      );

      expect(validResponse.status).toBe(200);
      await expect(validResponse.json()).resolves.toEqual({ ok: true });

      const namespaceResponse = await handler.handler(
        new Request('http://127.0.0.1:3399/ping', {
          headers: {
            origin: 'http://allowed.test',
            [DEFAULT_DATA_ENVELOPE_HEADER]: createEnvelopeHeader({
              endpoint: 'ping',
              routePath: '/ping',
              namespace: 'remote-app',
              origin: 'http://allowed.test',
            }),
          },
        }),
      );

      expect(namespaceResponse.status).toBe(400);
      await expect(namespaceResponse.json()).resolves.toMatchObject({
        message: 'Invalid data envelope',
        errors: expect.arrayContaining([
          expect.stringContaining('Namespace mismatch'),
        ]),
      });

      const originResponse = await handler.handler(
        new Request('http://127.0.0.1:3399/ping', {
          headers: {
            origin: 'http://allowed.test',
            [DEFAULT_DATA_ENVELOPE_HEADER]: createEnvelopeHeader({
              endpoint: 'ping',
              routePath: '/ping',
              origin: 'http://forged.test',
            }),
          },
        }),
      );

      expect(originResponse.status).toBe(400);
      await expect(originResponse.json()).resolves.toMatchObject({
        message: 'Invalid data envelope',
        errors: expect.arrayContaining([
          expect.stringContaining('Origin mismatch'),
        ]),
      });
    } finally {
      await handler.dispose();
    }
  });

  test('validates each protocol-v2 batch envelope and propagates its trace context', async () => {
    const handler = createHttpApiHandler({
      api,
      layer,
      dataPlatform: {
        requireEnvelope: true,
        expectedNamespace: 'test-app',
        batch: { enabled: true },
      },
    });

    try {
      const response = await handler.handler(
        new Request('http://localhost/_data/batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            protocolVersion: 2,
            batchId: 'batch-envelope-validation',
            sentAt: 1_700_000_000_000,
            items: [
              {
                id: 'traced',
                path: '/trace-header',
                method: 'GET',
                headers: {
                  [DEFAULT_DATA_ENVELOPE_HEADER]: createEnvelopeHeader({
                    endpoint: 'traceHeader',
                    routePath: '/trace-header',
                    traceContext: {
                      traceId: '11111111111111111111111111111111',
                      spanId: '2222222222222222',
                      sampled: true,
                    },
                  }),
                },
              },
              {
                id: 'wrong-namespace',
                path: '/ping',
                method: 'GET',
                headers: {
                  [DEFAULT_DATA_ENVELOPE_HEADER]: createEnvelopeHeader({
                    endpoint: 'ping',
                    routePath: '/ping',
                    namespace: 'remote-app',
                  }),
                },
              },
            ],
          }),
        }),
      );
      const payload = (await response.json()) as DataBatchResponsePayload;

      expect(response.status).toBe(200);
      expect(payload.protocolVersion).toBe(2);
      expect(payload.items.map(item => [item.id, item.status])).toEqual([
        ['traced', 200],
        ['wrong-namespace', 400],
      ]);
      expect(JSON.parse(decodeBody(payload.items[0]?.body))).toEqual({
        traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
      });
      expect(decodeBody(payload.items[1]?.body)).toContain(
        'Namespace mismatch',
      );
    } finally {
      await handler.dispose();
    }
  });

  test('falls through to the HttpApi router when the batch gateway is disabled', async () => {
    const handler = createHttpApiHandler({
      api,
      layer,
      dataPlatform: { batch: { enabled: false } },
    });

    try {
      const response = await handler.handler(
        new Request('http://localhost/_data/batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            protocolVersion: 2,
            batchId: 'batch-disabled',
            sentAt: 1_700_000_000_000,
            items: [{ id: 'ping', path: '/ping', method: 'GET' }],
          }),
        }),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get('x-modernjs-data-batch')).toBeNull();
    } finally {
      await handler.dispose();
    }
  });
});
