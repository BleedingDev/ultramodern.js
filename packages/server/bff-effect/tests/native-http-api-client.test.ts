import * as Effect from 'effect/Effect';
import { FetchHttpClient } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import { createHttpApiHandler } from '../src/effect';
import { createEffectOperationContext } from '../src/effect/operation-context';
import { makeEffectHttpApiClient } from '../src/effect-client';

class ItemMissing extends Schema.TaggedError<ItemMissing>()('ItemMissing', {
  id: Schema.String,
}) {}
const api = HttpApi.make('NativeClientApi').add(
  HttpApiGroup.make('items').add(
    HttpApiEndpoint.get('read', '/items/:id', {
      params: { id: Schema.String },
      query: { count: Schema.FiniteFromString },
      success: Schema.Struct({ id: Schema.String, count: Schema.Number }),
      error: ItemMissing.pipe(HttpApiSchema.status(404)),
    }),
    HttpApiEndpoint.post('create', '/items', {
      payload: Schema.Struct({ title: Schema.String }),
      success: Schema.Struct({ title: Schema.String }),
    }),
  ),
);
const handlers = HttpApiBuilder.group(api, 'items', handlers =>
  handlers
    .handle('read', ({ params, query }) =>
      params.id === 'missing'
        ? Effect.fail(new ItemMissing({ id: params.id }))
        : Effect.succeed({ id: params.id, count: query.count }),
    )
    .handle('create', ({ payload }) => Effect.succeed(payload)),
);

test('native HttpApi clients encode requests and decode responses and declared errors from the shared contract', async () => {
  const server = createHttpApiHandler({
    api,
    layer: HttpApiBuilder.layer(api).pipe(Layer.provide(handlers)),
  });
  const requests: Request[] = [];
  const transport = rstest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      return server.handler(request);
    });
  try {
    const client = await Effect.runPromise(
      makeEffectHttpApiClient(api, {
        baseUrl: 'http://localhost',
        requestContext: { locale: 'cs' },
      }),
    );
    await expect(
      Effect.runPromise(
        client.items.read({ params: { id: '42' }, query: { count: 3 } }),
      ),
    ).resolves.toEqual({ id: '42', count: 3 });
    expect(new URL(requests[0]!.url).searchParams.get('count')).toBe('3');
    expect(requests[0]!.headers.get('accept-language')).toBe('cs');
    await expect(
      Effect.runPromise(client.items.create({ payload: { title: 'native' } })),
    ).resolves.toEqual({ title: 'native' });
    const error = await Effect.runPromise(
      client.items
        .read({ params: { id: 'missing' }, query: { count: 1 } })
        .pipe(Effect.flip),
    );
    expect(error).toBeInstanceOf(ItemMissing);
    expect(error).toMatchObject({ _tag: 'ItemMissing', id: 'missing' });
    transport.mockResolvedValueOnce(
      Response.json({ id: 42, count: 'invalid' }),
    );
    const invalid = await Effect.runPromise(
      client.items
        .read({ params: { id: '42' }, query: { count: 1 } })
        .pipe(Effect.flip),
    );
    expect(invalid._tag).toBe('SchemaError');
  } finally {
    transport.mockRestore();
    await server.dispose();
  }
});

test('native HttpApi clients forward operation context and headers the server reads', async () => {
  const server = createHttpApiHandler({
    api,
    layer: HttpApiBuilder.layer(api).pipe(Layer.provide(handlers)),
  });
  const requests: Request[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    return server.handler(request);
  };
  try {
    const client = await Effect.runPromise(
      makeEffectHttpApiClient(api, {
        baseUrl: 'http://localhost',
        headers: {
          Authorization: 'Bearer token',
          'x-absent': undefined,
          'accept-language': 'en',
        },
        requestContext: {
          locale: 'cs',
          operationContext: {
            operationId: 'NativeClientApi:items:read',
            routePath: '/items/:id',
            method: 'GET',
            source: 'client',
            operationVersion: 2,
            sessionClaims: { subject: 'private' },
          },
        },
      }),
    );
    await Effect.runPromise(
      client.items
        .read({ params: { id: '42' }, query: { count: 1 } })
        .pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
    );
    const [request] = requests;
    expect(request!.headers.get('authorization')).toBe('Bearer token');
    expect(request!.headers.has('x-absent')).toBe(false);
    // The request context is more specific than the generic headers.
    expect(request!.headers.get('accept-language')).toBe('cs');
    expect(request!.headers.get('x-operation-id')).toBe(
      'NativeClientApi:items:read',
    );
    const detail = JSON.parse(
      request!.headers.get('x-modernjs-bff-operation-context')!,
    );
    expect(detail).toEqual({
      operationId: 'NativeClientApi:items:read',
      routePath: '/items/:id',
      method: 'GET',
      operationVersion: 2,
    });
    expect(
      createEffectOperationContext({
        request: request!,
        env: {},
        path: '/items/42',
        method: 'GET',
      }),
    ).toMatchObject({
      operationId: 'NativeClientApi:items:read',
      operationVersion: 2,
      locale: 'cs',
    });
  } finally {
    await server.dispose();
  }
});

test('native transport supplies verifiable cross-project contracts for parameterized routes', async () => {
  const { buildOperationContractMap } = await import(
    '@modern-js/server-runtime-extensions/bff-policy/node'
  );
  const { evaluateCrossProjectPolicy, resolveCrossProjectRequestObservation } =
    await import('@modern-js/server-runtime-extensions/bff-policy');
  const expectedOperationContracts = buildOperationContractMap({
    requestId: 'inventory',
    operationVersion: 2,
    handlers: [
      { name: 'read', httpMethod: 'GET', routePath: '/api/items/:id' },
    ],
  });
  const policy = {
    enabled: true,
    requestId: 'inventory',
    expectedOperationContracts,
  };
  const server = createHttpApiHandler({
    api,
    layer: HttpApiBuilder.layer(api).pipe(Layer.provide(handlers)),
  });
  const violations: Array<string | null> = [];
  const transport = rstest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const observed = resolveCrossProjectRequestObservation(
        { method: request.method, pathname: url.pathname },
        policy,
      );
      const violation = evaluateCrossProjectPolicy(
        Object.fromEntries(request.headers),
        policy,
        observed,
      );
      violations.push(violation?.reason ?? null);
      if (violation)
        return Promise.resolve(Response.json(violation, { status: 403 }));
      url.pathname = url.pathname.slice('/api'.length);
      return server.handler(new Request(url, request));
    });
  try {
    const client = await Effect.runPromise(
      makeEffectHttpApiClient(api, {
        baseUrl: 'http://native-client.test/api',
        crossProject: {
          requestId: 'inventory',
          operationVersion: 2,
          prefix: '/api',
        },
      }),
    );
    await expect(
      Effect.runPromise(
        client.items
          .read({ params: { id: 'a b' }, query: { count: 3 } })
          .pipe(Effect.provideService(FetchHttpClient.Fetch, transport)),
      ),
    ).resolves.toEqual({ id: 'a b', count: 3 });
    const stale = await Effect.runPromise(
      makeEffectHttpApiClient(api, {
        baseUrl: 'http://native-client.test/api',
        crossProject: {
          requestId: 'inventory',
          operationVersion: 1,
          prefix: '/api',
        },
      }),
    );
    await expect(
      Effect.runPromise(
        stale.items
          .read({ params: { id: 'old' }, query: { count: 3 } })
          .pipe(Effect.provideService(FetchHttpClient.Fetch, transport)),
      ),
    ).rejects.toBeDefined();
    expect(violations).toEqual([null, 'operation_version_mismatch']);
  } finally {
    transport.mockRestore();
    await server.dispose();
  }
});
