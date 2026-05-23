import {
  createHttpApiHandler,
  Effect,
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  Layer,
  Schema,
} from '../src/runtime/effect';

class RecommendationNotFound extends Schema.TaggedErrorClass<RecommendationNotFound>()(
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

const recommendationsApi = HttpApi.make('RecommendationsContractTestApi').add(
  HttpApiGroup.make('recommendations')
    .add(
      HttpApiEndpoint.get('list', '/effect/recommendations', {
        query: {
          limit: Schema.optional(Schema.NumberFromString),
        },
        success: Schema.Struct({
          items: Schema.Array(recommendationItemSchema),
        }),
      }),
    )
    .add(
      HttpApiEndpoint.get('get', '/effect/recommendations/:id', {
        params: {
          id: Schema.String,
        },
        success: recommendationItemSchema,
        error: recommendationNotFoundSchema,
      }),
    )
    .add(
      HttpApiEndpoint.post('create', '/effect/recommendations', {
        payload: Schema.Struct({
          title: Schema.String,
        }),
        success: Schema.Struct({
          item: recommendationItemSchema,
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

describe('effect HttpApi schema validation', () => {
  test('runs valid params, query, and payload through typed handlers', async () => {
    const { handledCalls, handler } = createRecommendationsHandler();

    try {
      const listResponse = await handler.handler(
        new Request('http://localhost/effect/recommendations?limit=1'),
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
        new Request(
          'http://localhost/effect/recommendations/starter-recommendations',
        ),
      );
      expect(getResponse.status).toBe(200);
      await expect(getResponse.json()).resolves.toEqual({
        id: 'starter-recommendations',
        title: 'Starter recommendations',
      });

      const createResponse = await handler.handler(
        new Request('http://localhost/effect/recommendations', {
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
        new Request('http://localhost/effect/recommendations', {
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

  test('maps schema-owned typed errors to declared HttpApi status', async () => {
    const { handler } = createRecommendationsHandler();

    try {
      const response = await handler.handler(
        new Request('http://localhost/effect/recommendations/missing'),
      );

      expect(response.status).toBe(404);
    } finally {
      await handler.dispose();
    }
  });
});
