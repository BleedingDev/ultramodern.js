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
  useEffectContext,
} from '../src/effect/edge';

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
      new Request('http://localhost/api/ping'),
      {
        prefix: '/api',
        env: {
          RUNTIME: 'cloudflare',
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      requestPath: '/ping',
      contextPath: '/api/ping',
      routePath: '/ping',
      mountedPath: '/api/ping',
      env: 'cloudflare',
    });
  });

  test('dispatches one-argument handlers with Effect context env', async () => {
    const response = await dispatchEffectBffRequest(
      request => {
        const context = useEffectContext();

        return Response.json({
          requestPath: new URL(request.url).pathname,
          contextPath: context.path,
          routePath: context.operationContext.routePath,
          env: context.env.RUNTIME,
        });
      },
      new Request('http://localhost/api/context'),
      {
        prefix: '/api',
        env: {
          RUNTIME: 'cloudflare',
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      requestPath: '/context',
      contextPath: '/api/context',
      routePath: '/context',
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
      new Request('http://localhost/api/missing'),
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
      new Request('http://localhost/api/failure'),
      {
        prefix: '/api',
      },
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal Server Error',
        status: 500,
      },
    });
  });

  test('wraps non-Response handler returns as JSON runtime errors', async () => {
    const response = await dispatchEffectBffRequest(
      () => 'not a response' as unknown as Response,
      new Request('http://localhost/api/invalid'),
      {
        prefix: '/api',
      },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal Server Error',
        status: 500,
      },
    });
  });

  test('wraps maintenance errors with Retry-After when no onError response is returned', async () => {
    const maintenance = Object.assign(new Error('maintenance detail'), {
      status: 503,
      retryAfter: '180',
    });
    const onErrorCalls: unknown[] = [];

    const response = await dispatchEffectBffRequest(
      () => {
        throw maintenance;
      },
      new Request('http://localhost/api/maintenance'),
      {
        prefix: '/api',
        onError: error => {
          onErrorCalls.push(error);
          return undefined as unknown as Response;
        },
      },
    );

    expect(onErrorCalls).toEqual([maintenance]);
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('180');
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service Unavailable',
        status: 503,
      },
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

  test('rejects unbranded edge createHandler exports', async () => {
    const warnings: string[] = [];

    await expect(
      createEffectBffEdgeHandler({
        module: {
          createHandler: () => ({
            handler: () => new Response('legacy'),
            dispose: async () => {},
          }),
        },
        onWarning: message => warnings.push(message),
      }),
    ).rejects.toThrow(/Invalid Effect edge module/u);
    expect(
      warnings.some(message => message.includes('strictEffectApproach')),
    ).toBe(true);
  });

  test('rejects factories spoofing the former global validator brand', async () => {
    const createHandler = () => ({
      handler: () => new Response('forged'),
      dispose: async () => {},
    });
    Object.defineProperty(
      createHandler,
      Symbol.for('modernjs.effect.validatorAware'),
      { value: true },
    );

    await expect(
      createEffectBffEdgeHandler({ module: { createHandler } }),
    ).rejects.toThrow(/Invalid Effect edge module/u);
  });

  test('serves OpenAPI, method/not-found, and data-platform validation from api/layer fallback', async () => {
    const api = HttpApi.make('EdgeEffectApi').add(
      HttpApiGroup.make('greetings').add(
        HttpApiEndpoint.get('ping', '/ping', {
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
            '/ping': expect.any(Object),
          }),
        }),
      );

      const postResponse = await edge.handler(
        new Request('http://localhost/api/ping', {
          method: 'POST',
        }),
      );
      expect(postResponse.status).toBe(404);

      const missingResponse = await edge.handler(
        new Request('http://localhost/api/missing'),
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
        new Request('http://localhost/api/ping'),
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

  test('edge-safe entry exposes scoped Effect context helpers', async () => {
    const edgeRuntime = await import('../src/effect/edge');
    expect(typeof edgeRuntime.useEffectContext).toBe('function');
    expect(typeof edgeRuntime.useOperationContext).toBe('function');

    const response = await edgeRuntime.dispatchEffectBffRequest(
      () =>
        new Response(
          JSON.stringify({
            path: edgeRuntime.useEffectContext().path,
            method: edgeRuntime.useOperationContext().method,
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      new Request('http://localhost/api/ping'),
      { prefix: '/api' },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      path: '/api/ping',
      method: 'GET',
    });
  });

  test('isolates Effect context between interleaved edge requests', async () => {
    let markFirstEntered!: () => void;
    let markSecondEntered!: () => void;
    let markFirstFinished!: () => void;
    const firstEntered = new Promise<void>(resolve => {
      markFirstEntered = resolve;
    });
    const secondEntered = new Promise<void>(resolve => {
      markSecondEntered = resolve;
    });
    const firstFinished = new Promise<void>(resolve => {
      markFirstFinished = resolve;
    });

    const firstResponsePromise = dispatchEffectBffRequest(
      async () => {
        const before = useEffectContext().path;
        markFirstEntered();
        await secondEntered;
        return Response.json({ before, after: useEffectContext().path });
      },
      new Request('http://localhost/api/first'),
      { prefix: '/api' },
    );

    await firstEntered;
    const secondResponsePromise = dispatchEffectBffRequest(
      async () => {
        const before = useEffectContext().path;
        markSecondEntered();
        await firstFinished;
        return Response.json({ before, after: useEffectContext().path });
      },
      new Request('http://localhost/api/second'),
      { prefix: '/api' },
    );

    const firstResponse = await firstResponsePromise;
    markFirstFinished();
    const secondResponse = await secondResponsePromise;

    expect(firstResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toEqual({
      before: '/api/first',
      after: '/api/first',
    });
    expect(secondResponse.status).toBe(200);
    await expect(secondResponse.json()).resolves.toEqual({
      before: '/api/second',
      after: '/api/second',
    });
  });
});
