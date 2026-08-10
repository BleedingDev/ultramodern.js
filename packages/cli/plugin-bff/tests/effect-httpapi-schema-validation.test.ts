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
} from '../src/runtime/effect';

class RecommendationNotFound extends Schema.TaggedError<RecommendationNotFound>()(
  'RecommendationNotFound',
  {
    id: Schema.String,
  },
) {}

const recommendationItemSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
});

const recommendationNotFoundSchema = RecommendationNotFound.pipe(
  HttpApiSchema.status(404),
);

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
          limit: Schema.optional(Schema.NumberFromString),
        },
        success: Schema.Struct({
          items: Schema.Array(recommendationItemSchema),
        }),
      }),
    )
    .add(
      HttpApiEndpoint.get('get', '/recommendations/:id', {
        params: {
          id: Schema.String,
        },
        success: recommendationItemSchema,
        error: recommendationNotFoundSchema,
      }),
    )
    .add(
      HttpApiEndpoint.post('create', '/recommendations', {
        payload: Schema.Struct({
          title: Schema.String,
        }),
        success: Schema.Struct({
          item: recommendationItemSchema,
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

function createRecommendationsHandler() {
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
          return Effect.succeed({
            ok: true,
          });
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
}

const requestScopedApi = HttpApi.make('RequestScopedContextMuxTestApi').add(
  HttpApiGroup.make('context').add(
    HttpApiEndpoint.get('read', '/context', {
      success: Schema.Struct({
        value: Schema.String,
      }),
    }),
  ),
);

function createRequestScopedContextHandler() {
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
}

describe('effect HttpApi schema validation', () => {
  test('runs valid params, query, and payload through typed handlers', async () => {
    const { handledCalls, handler } = createRecommendationsHandler();

    try {
      const listResponse = await handler.handler(
        new Request('http://localhost/recommendations?limit=1'),
      );
      expect(listResponse.status).toBe(200);
      await expect(listResponse.json()).resolves.toEqual({
        items: [
          {
            id: 'starter-recommendations',
            title: 'Starter recommendations',
          },
        ],
      });

      const getResponse = await handler.handler(
        new Request('http://localhost/recommendations/starter-recommendations'),
      );
      expect(getResponse.status).toBe(200);
      await expect(getResponse.json()).resolves.toEqual({
        id: 'starter-recommendations',
        title: 'Starter recommendations',
      });

      const createResponse = await handler.handler(
        new Request('http://localhost/recommendations', {
          body: JSON.stringify({ title: 'New item' }),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        }),
      );
      expect(createResponse.status).toBe(200);
      await expect(createResponse.json()).resolves.toEqual({
        item: {
          id: 'generated-new item',
          title: 'New item',
        },
      });

      expect(handledCalls).toEqual(['list', 'get', 'create']);
    } finally {
      await handler.dispose();
    }
  });

  test('rejects invalid payload before the handler runs', async () => {
    const { handledCalls, handler } = createRecommendationsHandler();

    try {
      const response = await handler.handler(
        new Request('http://localhost/recommendations', {
          body: JSON.stringify({ title: 123 }),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        }),
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(handledCalls).toEqual([]);
    } finally {
      await handler.dispose();
    }
  });

  test('maps malformed JSON payloads to 400 before the handler runs', async () => {
    const { handledCalls, handler } = createRecommendationsHandler();

    try {
      const response = await handler.handler(
        new Request('http://localhost/recommendations', {
          body: '{',
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        message: 'Invalid JSON request body',
      });
      expect(handledCalls).toEqual([]);
    } finally {
      await handler.dispose();
    }
  });

  test('lets empty JSON-typed request bodies reach bodyless endpoints', async () => {
    const { handledCalls, handler } = createRecommendationsHandler();

    try {
      const response = await handler.handler(
        new Request('http://localhost/recommendations/reset', {
          body: '',
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
      });
      expect(handledCalls).toEqual(['reset']);
    } finally {
      await handler.dispose();
    }
  });

  test('lets bodyless JSON-typed requests reach bodyless endpoints', async () => {
    const { handledCalls, handler } = createRecommendationsHandler();

    try {
      const response = await handler.handler(
        new Request('http://localhost/recommendations/reset', {
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
      });
      expect(handledCalls).toEqual(['reset']);
    } finally {
      await handler.dispose();
    }
  });

  test('maps schema-owned typed errors to declared HttpApi status', async () => {
    const { handler } = createRecommendationsHandler();

    try {
      const response = await handler.handler(
        new Request('http://localhost/recommendations/missing'),
      );

      expect(response.status).toBe(404);
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
