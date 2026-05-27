import {
  createEffectBffEdgeHandler,
  dispatchEffectBffRequest,
  Effect,
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  Layer,
  Schema,
} from '../src/runtime/effect/edge';

describe('effect edge runtime', () => {
  test('dispatches direct Web Request/Response handlers with prefix-stripped context', async () => {
    const response = await dispatchEffectBffRequest(
      (request, context) =>
        Response.json({
          requestPath: new URL(request.url).pathname,
          contextPath: context?.path,
          routePath: context?.operationContext.routePath,
          mountedPath: context?.operationContext.attributes?.mountedPath,
          env: context?.env.RUNTIME,
        }),
      new Request('http://localhost/api/effect/ping'),
      {
        prefix: '/api',
        env: {
          RUNTIME: 'cloudflare',
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      requestPath: '/effect/ping',
      contextPath: '/api/effect/ping',
      routePath: '/effect/ping',
      mountedPath: '/api/effect/ping',
      env: 'cloudflare',
    });
  });

  test('returns handler-thrown Response instances without wrapping them as runtime errors', async () => {
    const response = await dispatchEffectBffRequest(
      () => {
        throw new Response('missing from handler', {
          status: 404,
          headers: {
            'x-effect-edge': 'thrown-response',
          },
        });
      },
      new Request('http://localhost/api/effect/missing'),
      {
        prefix: '/api',
      },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('x-effect-edge')).toBe('thrown-response');
    await expect(response.text()).resolves.toBe('missing from handler');
  });

  test('wraps handler-thrown Error instances as JSON runtime errors', async () => {
    const response = await dispatchEffectBffRequest(
      () => {
        throw new Error('edge handler failed');
      },
      new Request('http://localhost/api/effect/failure'),
      {
        prefix: '/api',
      },
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({
      message: 'edge handler failed',
    });
  });

  test('wraps non-Response handler returns as JSON runtime errors', async () => {
    const response = await dispatchEffectBffRequest(
      () => 'not a response' as unknown as Response,
      new Request('http://localhost/api/effect/invalid'),
      {
        prefix: '/api',
      },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: '[BFF][Effect] Effect handler must return a Response instance.',
    });
  });

  test('does not dispatch to the Effect handler when request path misses the configured prefix', async () => {
    let handled = false;
    const response = await dispatchEffectBffRequest(
      () => {
        handled = true;
        return new Response('unexpected');
      },
      new Request('http://localhost/assets/logo.png'),
      {
        prefix: '/api',
      },
    );

    expect(handled).toBe(false);
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe('');
  });

  test('creates edge handler from createHandler export and passes runtime options', async () => {
    let disposeCalls = 0;
    const edge = await createEffectBffEdgeHandler({
      module: {
        createHandler: options => ({
          handler: request =>
            Response.json({
              path: new URL(request.url).pathname,
              openapi: options?.openapi,
              requireEnvelope: options?.dataPlatform?.requireEnvelope,
            }),
          dispose: async () => {
            disposeCalls += 1;
          },
        }),
      },
      prefix: '/api',
      openapi: {
        path: '/openapi.json',
      },
      dataPlatform: {
        requireEnvelope: true,
      },
    });

    const response = await edge.handler(
      new Request('http://localhost/api/effect/options'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      path: '/effect/options',
      openapi: {
        path: '/openapi.json',
      },
      requireEnvelope: true,
    });

    await edge.dispose();
    expect(disposeCalls).toBe(1);
  });

  test('serves OpenAPI, method/not-found, and data-platform validation from api/layer fallback', async () => {
    const api = HttpApi.make('EdgeEffectApi').add(
      HttpApiGroup.make('greetings').add(
        HttpApiEndpoint.get('ping', '/effect/ping', {
          success: Schema.Struct({
            ok: Schema.Boolean,
          }),
        }),
      ),
    );
    const groupLayer = HttpApiBuilder.group(api, 'greetings', handlers =>
      handlers.handle('ping', () =>
        Effect.succeed({
          ok: true,
        }),
      ),
    );
    const edge = await createEffectBffEdgeHandler({
      module: {
        api,
        layer: HttpApiBuilder.layer(api).pipe(Layer.provide(groupLayer)),
      },
      prefix: '/api',
      openapi: {
        path: '/openapi.json',
      },
    });

    try {
      const openApiResponse = await edge.handler(
        new Request('http://localhost/api/openapi.json'),
      );
      expect(openApiResponse.status).toBe(200);
      await expect(openApiResponse.json()).resolves.toEqual(
        expect.objectContaining({
          openapi: expect.any(String),
          info: expect.any(Object),
          paths: expect.objectContaining({
            '/effect/ping': expect.any(Object),
          }),
        }),
      );

      const postResponse = await edge.handler(
        new Request('http://localhost/api/effect/ping', {
          method: 'POST',
        }),
      );
      expect(postResponse.status).toBe(404);

      const missingResponse = await edge.handler(
        new Request('http://localhost/api/effect/missing'),
      );
      expect(missingResponse.status).toBe(404);
    } finally {
      await edge.dispose();
    }

    const strictEdge = await createEffectBffEdgeHandler({
      module: {
        api,
        layer: HttpApiBuilder.layer(api).pipe(Layer.provide(groupLayer)),
      },
      prefix: '/api',
      dataPlatform: {
        requireEnvelope: true,
      },
    });

    try {
      const missingEnvelopeResponse = await strictEdge.handler(
        new Request('http://localhost/api/effect/ping'),
      );
      expect(missingEnvelopeResponse.status).toBe(400);
      await expect(missingEnvelopeResponse.json()).resolves.toEqual(
        expect.objectContaining({
          message: expect.stringContaining(
            'Missing required data envelope header',
          ),
        }),
      );
    } finally {
      await strictEdge.dispose();
    }
  });

  test('edge-safe entry does not import Node-only Effect context surface', async () => {
    const edgeRuntime = await import('../src/runtime/effect/edge');
    expect('useEffectContext' in edgeRuntime).toBe(false);
    expect('useOperationContext' in edgeRuntime).toBe(false);
  });
});
