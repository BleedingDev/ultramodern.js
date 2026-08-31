import * as Context from 'effect/Context';

import {
  createHttpApiHandler,
  Effect,
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  Layer,
  RpcGroup,
  Schema,
} from '../src/effect';

class RecommendationNotFound extends Schema.TaggedError<RecommendationNotFound>()(
  'RecommendationNotFound',
  {
    id: Schema.String,
  },
) {}

type RequestScopedValue = {
  value: string;
};
const RequestScopedValue =
  Context.Service<RequestScopedValue>('RequestScopedValue');

const recommendationsApi = HttpApi.make('RecommendationsContractTestApi').add(
  HttpApiGroup.make('recommendations')
    .add(
      HttpApiEndpoint.get('list', '/recommendations', {
        query: {
          limit: Schema.optional(Schema.FiniteFromString),
        },
        success: Schema.Struct({
          items: Schema.Array(
            Schema.Struct({
              id: Schema.String,
              title: Schema.String,
            }),
          ),
        }),
      }),
    )
    .add(
      HttpApiEndpoint.get('get', '/recommendations/:id', {
        params: {
          id: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/)),
        },
        success: Schema.Struct({
          id: Schema.String,
          title: Schema.String,
        }),
        error: RecommendationNotFound.pipe(HttpApiSchema.status(404)),
      }),
    )
    .add(
      HttpApiEndpoint.post('create', '/recommendations', {
        payload: Schema.Struct({
          title: Schema.String,
        }),
        success: Schema.Struct({
          item: Schema.Struct({
            id: Schema.String,
            title: Schema.String,
          }),
        }),
      }),
    )
    .add(
      HttpApiEndpoint.post('reset', '/recommendations/reset', {
        success: Schema.Struct({
          ok: Schema.Boolean,
        }),
      }),
    ),
);

const createRecommendationsHandler = () => {
  const handledCalls: string[] = [];
  const items = [
    {
      id: 'starter-recommendations',
      title: 'Starter recommendations',
    },
  ];
  const groupLayer = HttpApiBuilder.group(
    recommendationsApi,
    'recommendations',
    handlers =>
      handlers
        .handle('list', ({ query }) => {
          handledCalls.push('list');
          return Effect.succeed({
            items:
              typeof query.limit === 'number'
                ? items.slice(0, query.limit)
                : items,
          });
        })
        .handle('get', ({ params }) => {
          handledCalls.push('get');
          if (params.id === 'invalid-success') {
            return Effect.succeed({
              id: 123 as never,
              title: 'Invalid success response',
            });
          }
          if (params.id === 'invalid-error') {
            return Effect.fail({
              _tag: 'RecommendationNotFound',
              id: 123,
            } as never);
          }
          const item = items.find(item => item.id === params.id);
          return item
            ? Effect.succeed(item)
            : Effect.fail(new RecommendationNotFound({ id: params.id }));
        })
        .handle('create', ({ payload }) => {
          handledCalls.push('create');
          return Effect.succeed({
            item: {
              id: `generated-${payload.title.toLowerCase()}`,
              title: payload.title,
            },
          });
        })
        .handle('reset', () => {
          handledCalls.push('reset');
          return Effect.succeed({ ok: true });
        }),
  );

  return {
    handledCalls,
    handler: createHttpApiHandler({
      api: recommendationsApi,
      layer: HttpApiBuilder.layer(recommendationsApi).pipe(
        Layer.provide(groupLayer),
      ),
    }),
  };
};

const requestScopedApi = HttpApi.make('RequestScopedContextMuxTestApi').add(
  HttpApiGroup.make('context').add(
    HttpApiEndpoint.get('read', '/context', {
      success: Schema.Struct({
        value: Schema.String,
      }),
    }),
  ),
);

const createRequestScopedContextHandler = () => {
  const groupLayer = HttpApiBuilder.group(
    requestScopedApi,
    'context',
    handlers =>
      handlers.handle('read', () =>
        Effect.map(Effect.service(RequestScopedValue), service => ({
          value: service.value,
        })),
      ),
  );

  return createHttpApiHandler({
    api: requestScopedApi,
    layer: HttpApiBuilder.layer(requestScopedApi).pipe(
      Layer.provide(groupLayer),
    ),
    rpc: {
      group: RpcGroup.make(),
      layer: Layer.empty,
    },
  });
};

describe('Effect HttpApi schema and error handling', () => {
  test.each([
    {
      expectedBody: '',
      expectedCalls: [],
      expectedStatus: 400,
      name: 'rejects invalid params before dispatch',
      readBody: (response: Response) => response.text(),
      request: () => new Request('http://localhost/recommendations/INVALID'),
    },
    {
      expectedBody: '',
      expectedCalls: [],
      expectedStatus: 400,
      name: 'rejects invalid query values before dispatch',
      readBody: (response: Response) => response.text(),
      request: () =>
        new Request('http://localhost/recommendations?limit=invalid'),
    },
    {
      expectedBody: '',
      expectedCalls: [],
      expectedStatus: 400,
      name: 'rejects invalid payload values before dispatch',
      readBody: (response: Response) => response.text(),
      request: () =>
        new Request('http://localhost/recommendations', {
          body: JSON.stringify({ title: 123 }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }),
    },
    {
      expectedBody: {
        _tag: 'RecommendationNotFound',
        id: 'missing',
      },
      expectedCalls: ['get'],
      expectedStatus: 404,
      name: 'maps declared typed errors to their HttpApi status',
      readBody: (response: Response) => response.json(),
      request: () => new Request('http://localhost/recommendations/missing'),
    },
    {
      expectedBody: { message: 'Invalid JSON request body' },
      expectedCalls: [],
      expectedStatus: 400,
      name: 'maps malformed JSON to 400 before dispatch',
      readBody: (response: Response) => response.json(),
      request: () =>
        new Request('http://localhost/recommendations', {
          body: '{',
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }),
    },
    {
      expectedBody: { ok: true },
      expectedCalls: ['reset'],
      expectedStatus: 200,
      name: 'accepts an empty JSON-typed body for a bodyless endpoint',
      readBody: (response: Response) => response.json(),
      request: () =>
        new Request('http://localhost/recommendations/reset', {
          body: '',
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }),
    },
    {
      expectedBody: { ok: true },
      expectedCalls: ['reset'],
      expectedStatus: 200,
      name: 'accepts an absent JSON-typed body for a bodyless endpoint',
      readBody: (response: Response) => response.json(),
      request: () =>
        new Request('http://localhost/recommendations/reset', {
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }),
    },
  ])('$name', async ({
    expectedBody,
    expectedCalls,
    expectedStatus,
    readBody,
    request,
  }) => {
    const { handledCalls, handler } = createRecommendationsHandler();

    try {
      const response = await handler.handler(request());

      expect(response.status).toBe(expectedStatus);
      await expect(readBody(response)).resolves.toEqual(expectedBody);
      expect(handledCalls).toEqual(expectedCalls);
    } finally {
      await handler.dispose();
    }
  });

  test.each([
    {
      expectedStatus: 400,
      name: 'success',
      request: () =>
        new Request('http://localhost/recommendations/invalid-success'),
    },
    {
      expectedStatus: 500,
      name: 'error',
      request: () =>
        new Request('http://localhost/recommendations/invalid-error'),
    },
  ])('returns an opaque failure for invalid $name response schema encoding', async ({
    expectedStatus,
    request,
  }) => {
    const { handledCalls, handler } = createRecommendationsHandler();

    try {
      const response = await handler.handler(request());

      expect(response.status).toBe(expectedStatus);
      await expect(response.text()).resolves.toBe('');
      expect(handledCalls).toEqual(['get']);
    } finally {
      await handler.dispose();
    }
  });

  test('preserves Effect request context for HttpApi requests when RPC is enabled', async () => {
    const handler = createRequestScopedContextHandler();
    const requestContext = Context.make(RequestScopedValue, {
      value: 'from-request-context',
    });

    try {
      const response = await handler.handler(
        new Request('http://localhost/context'),
        requestContext,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        value: 'from-request-context',
      });
    } finally {
      await handler.dispose();
    }
  });
});
