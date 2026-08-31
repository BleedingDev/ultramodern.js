import {
  createEffectBffEdgeHandler,
  Effect,
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  Layer,
  Schema,
} from '../src/effect/edge';

describe('Effect BFF OpenAPI configuration', () => {
  const api = HttpApi.make('OpenApiConfigApi').add(
    HttpApiGroup.make('health').add(
      HttpApiEndpoint.get('status', '/status', {
        success: Schema.Struct({ ok: Schema.Boolean }),
      }),
    ),
  );
  const groupLayer = HttpApiBuilder.group(api, 'health', handlers =>
    handlers.handle('status', () => Effect.succeed({ ok: true })),
  );
  const layer = HttpApiBuilder.layer(api).pipe(Layer.provide(groupLayer));

  test.each([
    true,
    {},
  ])('serves the default path when OpenAPI is enabled with %j', async openapi => {
    const edge = await createEffectBffEdgeHandler({
      module: { api, layer },
      prefix: '/api',
      openapi,
    });

    try {
      const response = await edge.handler(
        new Request('http://localhost/api/openapi.json'),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({
          openapi: expect.any(String),
          paths: expect.objectContaining({
            '/status': expect.any(Object),
          }),
        }),
      );
    } finally {
      await edge.dispose();
    }
  });

  test.each([
    false,
    undefined,
  ])('does not serve the default path when OpenAPI is %j', async openapi => {
    const edge = await createEffectBffEdgeHandler({
      module: { api, layer },
      prefix: '/api',
      openapi,
    });

    try {
      const response = await edge.handler(
        new Request('http://localhost/api/openapi.json'),
      );
      expect(response.status).toBe(404);
    } finally {
      await edge.dispose();
    }
  });

  test('preserves and normalizes an explicit path', async () => {
    const edge = await createEffectBffEdgeHandler({
      module: { api, layer },
      prefix: '/api',
      openapi: { path: 'schema/openapi.json' },
    });

    try {
      const customResponse = await edge.handler(
        new Request('http://localhost/api/schema/openapi.json'),
      );
      const defaultResponse = await edge.handler(
        new Request('http://localhost/api/openapi.json'),
      );

      expect(customResponse.status).toBe(200);
      expect(defaultResponse.status).toBe(404);
    } finally {
      await edge.dispose();
    }
  });
});
