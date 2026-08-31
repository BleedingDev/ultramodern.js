import type {
  DataBatchBody,
  DataBatchResponsePayload,
} from '../src/data-platform';
import {
  createHttpApiHandler,
  Effect,
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  Layer,
  Schema,
} from '../src/effect';

const api = HttpApi.make('BatchSecurityApi').add(
  HttpApiGroup.make('batch').add(
    HttpApiEndpoint.get('ping', '/ping', {
      success: Schema.Struct({ ok: Schema.Boolean }),
    }),
  ),
);

const groupLayer = HttpApiBuilder.group(api, 'batch', handlers =>
  handlers.handle('ping', () => Effect.succeed({ ok: true })),
);

const layer = HttpApiBuilder.layer(api).pipe(Layer.provide(groupLayer));

const createBatchRequest = (
  batchId: string,
  items: ReadonlyArray<Record<string, unknown>>,
  headers: HeadersInit = {},
) =>
  new Request('http://localhost/_data/batch', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      protocolVersion: 2,
      batchId,
      sentAt: 1_700_000_000_000,
      items,
    }),
  });

const decodeBody = (body?: DataBatchBody) =>
  body ? Buffer.from(body.data, 'base64').toString('utf8') : '';

describe('Effect batch server trust boundary', () => {
  test('binds auth and verified identity to the outer request and strips hop-by-hop headers', async () => {
    let forwardedHeaders: Headers | undefined;
    const handler = createHttpApiHandler({
      api,
      layer,
      validateRequest: request => {
        forwardedHeaders = request.headers;
      },
    });

    try {
      const response = await handler.handler(
        createBatchRequest(
          'batch-auth-boundary',
          [
            {
              id: 'forged-item',
              path: '/ping',
              method: 'GET',
              headers: {
                authorization: 'Bearer attacker',
                connection: 'x-item-connection-token',
                cookie: 'session=attacker',
                'keep-alive': 'timeout=5',
                'x-item-connection-token': 'must-not-survive',
                'x-verified-producer': 'attacker',
                'accept-language': 'cs-CZ',
              },
            },
          ],
          {
            authorization: 'Bearer trusted',
            cookie: 'session=trusted',
            'x-verified-producer': 'trusted-gateway',
          },
        ),
      );

      expect(response.status).toBe(200);
      expect(forwardedHeaders?.get('authorization')).toBe('Bearer trusted');
      expect(forwardedHeaders?.get('cookie')).toBe('session=trusted');
      expect(forwardedHeaders?.get('x-verified-producer')).toBe(
        'trusted-gateway',
      );
      expect(forwardedHeaders?.get('accept-language')).toBe('cs-CZ');
      expect(forwardedHeaders?.has('connection')).toBe(false);
      expect(forwardedHeaders?.has('keep-alive')).toBe(false);
      expect(forwardedHeaders?.has('x-item-connection-token')).toBe(false);
    } finally {
      await handler.dispose();
    }
  });

  test('does not synthesize absent outer trust headers from batch items', async () => {
    let forwardedHeaders: Headers | undefined;
    const handler = createHttpApiHandler({
      api,
      layer,
      validateRequest: request => {
        forwardedHeaders = request.headers;
      },
    });

    try {
      const response = await handler.handler(
        createBatchRequest('batch-auth-absence', [
          {
            id: 'forged-auth-item',
            path: '/ping',
            method: 'GET',
            headers: {
              authorization: 'Bearer attacker',
              cookie: 'session=attacker',
              'x-verified-producer': 'attacker',
              accept: 'application/json',
            },
          },
        ]),
      );

      expect(response.status).toBe(200);
      expect(forwardedHeaders?.has('authorization')).toBe(false);
      expect(forwardedHeaders?.has('cookie')).toBe(false);
      expect(forwardedHeaders?.has('x-verified-producer')).toBe(false);
      expect(forwardedHeaders?.get('accept')).toBe('application/json');
    } finally {
      await handler.dispose();
    }
  });

  test('rejects cross-origin items before dispatch', async () => {
    let dispatched = false;
    const handler = createHttpApiHandler({
      api,
      layer,
      validateRequest: () => {
        dispatched = true;
      },
    });

    try {
      const response = await handler.handler(
        createBatchRequest(
          'batch-cross-origin',
          [
            {
              id: 'cross-origin-item',
              path: '//attacker.example/private',
              method: 'GET',
            },
          ],
          {
            authorization: 'Bearer trusted',
            cookie: 'session=trusted',
          },
        ),
      );
      const payload = (await response.json()) as DataBatchResponsePayload;

      expect(response.status).toBe(200);
      expect(payload.items[0]?.status).toBe(400);
      expect(decodeBody(payload.items[0]?.body)).toContain('same origin');
      expect(dispatched).toBe(false);
    } finally {
      await handler.dispose();
    }
  });

  test('normalizes mounted-prefix item paths through the public handler', async () => {
    const handler = createHttpApiHandler({ api, layer });

    try {
      const response = await handler.handler(
        createBatchRequest('batch-prefixed', [
          {
            id: 'prefixed-ping',
            path: '/bff-api/ping',
            method: 'GET',
          },
        ]),
        {
          path: '/bff-api/_data/batch',
          method: 'POST',
          env: {},
        } as unknown as Parameters<typeof handler.handler>[1],
      );
      const payload = (await response.json()) as DataBatchResponsePayload;

      expect(response.status).toBe(200);
      expect(payload.items[0]?.id).toBe('prefixed-ping');
      expect(payload.items[0]?.status).toBe(200);
      expect(JSON.parse(decodeBody(payload.items[0]?.body))).toEqual({
        ok: true,
      });
    } finally {
      await handler.dispose();
    }
  });

  test('returns a per-item failure when the required envelope is absent', async () => {
    const handler = createHttpApiHandler({
      api,
      layer,
      dataPlatform: { requireEnvelope: true },
    });

    try {
      const response = await handler.handler(
        createBatchRequest('batch-missing-envelope', [
          {
            id: 'missing-envelope',
            path: '/ping',
            method: 'GET',
          },
        ]),
      );
      const payload = (await response.json()) as DataBatchResponsePayload;

      expect(response.status).toBe(200);
      expect(payload.items[0]?.id).toBe('missing-envelope');
      expect(payload.items[0]?.status).toBe(400);
      expect(decodeBody(payload.items[0]?.body)).toContain(
        'Missing required data envelope header',
      );
    } finally {
      await handler.dispose();
    }
  });
});
