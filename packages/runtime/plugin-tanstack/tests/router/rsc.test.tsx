import { UNSAFE_ErrorResponseImpl as ErrorResponseImpl } from '@modern-js/runtime-utils/router';
import type React from 'react';
import { isValidElement } from 'react';
import { createRscProxy } from '../../src/runtime/rsc/createRscProxy';
import {
  reviveTanstackRscFlightValues,
  serializeTanstackRscFlightValues,
} from '../../src/runtime/rsc/flightSerialization';
import {
  __setTanstackRscPayloadDecoderForTests,
  createTanstackRscServerPayload,
  handleTanstackRscRedirect,
  loadTanstackRscRouteData,
} from '../../src/runtime/rsc/payloadRouter';
import { ReplayableStream } from '../../src/runtime/rsc/ReplayableStream';
import {
  RENDERABLE_RSC,
  RSC_PROXY_PATH,
  SERVER_COMPONENT_STREAM,
  type ServerComponentStream,
} from '../../src/runtime/rsc/symbols';

async function readAll(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: number[] = [];

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(...value);
  }

  return chunks;
}

function withNodeEnv<T>(value: string, callback: () => T): T {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return callback();
  } finally {
    process.env.NODE_ENV = original;
  }
}

describe('tanstack rsc runtime helpers', () => {
  afterEach(() => {
    __setTanstackRscPayloadDecoderForTests();
    rstest.restoreAllMocks();
  });

  test('ReplayableStream creates independent readers from one source', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    });
    const replayable = new ReplayableStream(source);

    await expect(readAll(replayable.createReplayStream())).resolves.toEqual([
      1, 2, 3,
    ]);
    await expect(readAll(replayable.createReplayStream())).resolves.toEqual([
      1, 2, 3,
    ]);
  });

  test('revives shared structures that the Flight serializer preserves', async () => {
    const shared = { label: 'shared' };
    const serialized = serializeTanstackRscFlightValues({
      left: shared,
      right: shared,
    }) as { left: unknown; right: unknown };

    const revived = (await reviveTanstackRscFlightValues(serialized)) as {
      left: unknown;
      right: unknown;
    };

    expect(serialized.left).toBe(serialized.right);
    expect(revived.left).toBe(revived.right);
  });

  test('renderable RSC proxies preserve React element behavior and metadata', () => {
    const stream: ServerComponentStream = {
      createReplayStream: () => new ReadableStream<Uint8Array>(),
    };
    const proxy = createRscProxy(() => ({ sidebar: 'ok' }), {
      renderable: true,
      stream,
    }) as React.ReactElement & Record<PropertyKey, unknown>;

    expect(isValidElement(proxy)).toBe(true);
    expect(proxy[SERVER_COMPONENT_STREAM]).toBe(stream);
    expect(proxy[RENDERABLE_RSC]).toBe(true);
    expect(proxy.then).toBeUndefined();
    expect('__SEROVAL_STREAM__' in proxy).toBe(false);
    expect('__SEROVAL_SEQUENCE__' in proxy).toBe(false);
    expect(Symbol.iterator in proxy).toBe(false);

    const sidebar = proxy.sidebar as Record<PropertyKey, unknown>;
    expect(sidebar[RSC_PROXY_PATH]).toEqual(['sidebar']);
  });

  test('creates TanStack RSC server payload and omits client-loader data during RSC navigation', () => {
    const payload = createTanstackRscServerPayload(
      {
        state: {
          location: { href: '/products' },
          matches: [
            {
              loaderData: { shell: true },
              params: {},
              pathname: '/',
              pathnameBase: '/',
              route: {
                id: '__root__',
                options: {
                  staticData: {
                    modernRouteHasLoader: true,
                    modernRouteId: 'root',
                  },
                },
              },
              routeId: '__root__',
            },
            {
              loaderData: { product: 1 },
              params: {},
              pathname: '/products',
              pathnameBase: '/products',
              route: {
                id: '/products',
                parentRoute: { id: '__root__' },
                options: {
                  path: 'products',
                  staticData: {
                    modernRouteHandle: { section: 'shop' },
                    modernRouteHasClientLoader: true,
                    modernRouteHasLoader: true,
                    modernRouteId: 'products',
                  },
                },
              },
              routeId: '/products',
            },
          ],
        },
      },
      { omitClientLoaderData: true },
    );

    expect(payload).toMatchObject({
      type: 'render',
      loaderData: {
        __root__: { shell: true },
      },
      routes: [
        {
          hasClientLoader: false,
          hasLoader: true,
          id: '__root__',
        },
        {
          handle: { section: 'shop' },
          hasClientLoader: true,
          hasLoader: true,
          id: '/products',
          parentId: '__root__',
          path: 'products',
        },
      ],
    });
    expect(
      (payload.loaderData as Record<string, unknown>)['/products'],
    ).toBeUndefined();
  });

  test('redacts production TanStack RSC server payload errors', () => {
    const routeError = new ErrorResponseImpl(
      500,
      'secret status text',
      'route secret',
      true,
    );
    const serverError = new Error('server secret');
    serverError.stack = 'stack secret';

    const payload = withNodeEnv('production', () =>
      createTanstackRscServerPayload({
        state: {
          location: { href: '/products' },
          matches: [
            {
              error: serverError,
              params: {},
              pathname: '/',
              pathnameBase: '/',
              route: { id: '__root__' },
              routeId: '__root__',
            },
            {
              error: routeError,
              params: {},
              pathname: '/products',
              pathnameBase: '/products',
              route: {
                id: '/products',
                parentRoute: { id: '__root__' },
                options: { path: 'products' },
              },
              routeId: '/products',
            },
          ],
        },
      }),
    );

    expect(payload.errors).toMatchObject({
      __root__: {
        message: 'Unexpected Server Error',
        stack: undefined,
        __type: 'Error',
      },
      '/products': {
        status: 500,
        statusText: 'Internal Server Error',
        data: 'Unexpected Server Error',
        __type: 'RouteErrorResponse',
      },
    });
    expect(JSON.stringify(payload.errors)).not.toContain('server secret');
    expect(JSON.stringify(payload.errors)).not.toContain('route secret');
    expect(JSON.stringify(payload.errors)).not.toContain('secret status text');
    expect(JSON.stringify(payload.errors)).not.toContain('stack secret');
  });

  test('redacts production TanStack RSC non-Error server payload errors', () => {
    const payload = withNodeEnv('production', () =>
      createTanstackRscServerPayload({
        state: {
          location: { href: '/plain' },
          matches: [
            {
              error: { message: 'plain secret', token: 'token secret' },
              params: {},
              pathname: '/plain',
              pathnameBase: '/plain',
              route: { id: '/plain' },
              routeId: '/plain',
            },
          ],
        },
      }),
    );

    expect(payload.errors).toMatchObject({
      '/plain': {
        message: 'Unexpected Server Error',
        stack: undefined,
        __type: 'Error',
      },
    });
    expect(JSON.stringify(payload.errors)).not.toContain('plain secret');
    expect(JSON.stringify(payload.errors)).not.toContain('token secret');
  });

  test('converts TanStack RSC redirects to Modern RSC navigation headers', () => {
    const response = handleTanstackRscRedirect(
      new Headers({ Location: '/base/login' }),
      '/base',
      302,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBeNull();
    expect(response.headers.get('X-Modernjs-Redirect')).toBe('/login');
    expect(response.headers.get('X-Modernjs-BaseUrl')).toBe('/base');
  });

  test('preserves TanStack RSC redirect paths that do not start with the basename', () => {
    const response = handleTanstackRscRedirect(
      new Headers({ Location: '/shop/base/login' }),
      '/base',
      302,
    );

    expect(response.headers.get('X-Modernjs-Redirect')).toBe(
      '/shop/base/login',
    );
  });

  test('preserves RSC redirect response status and headers in TanStack redirects', async () => {
    rstest.stubGlobal(
      'fetch',
      rstest.fn(() =>
        Promise.resolve(
          new Response(null, {
            headers: {
              'X-Modernjs-Redirect': '/login',
              'X-Trace': 'preserved',
            },
            status: 308,
          }),
        ),
      ),
    );

    const thrown = (await loadTanstackRscRouteData({
      loadClientData: async () => ({ fallback: true }),
      request: new Request('http://localhost/products'),
      routeId: '/products',
    }).then(
      () => {
        throw new Error('expected redirect');
      },
      err => err,
    )) as Response & {
      options?: { statusCode?: number; to?: string };
    };

    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(308);
    expect(thrown.headers.get('X-Trace')).toBe('preserved');
    expect(thrown.options?.statusCode).toBe(308);
    expect(thrown.options?.to).toBe('/login');
  });

  test('loads one RSC payload for multiple server route loaders', async () => {
    const payload = {
      type: 'render',
      actionData: null,
      errors: null,
      loaderData: {
        __root__: { shell: true },
        '/products': { product: 1 },
      },
      location: { href: '/products' },
      routes: [
        { id: '__root__', hasLoader: true },
        { id: '/products', hasLoader: true },
      ],
    };
    const fetchMock = rstest.fn(() => Promise.resolve(new Response('payload')));
    const decodeMock = rstest.fn(async () => payload);
    rstest.stubGlobal('fetch', fetchMock);
    __setTanstackRscPayloadDecoderForTests(decodeMock);

    const request = new Request('http://localhost/products');
    const [rootData, productData] = await Promise.all([
      loadTanstackRscRouteData({
        loadClientData: async () => ({ fallback: 'root' }),
        request,
        routeId: '__root__',
      }),
      loadTanstackRscRouteData({
        loadClientData: async () => ({ fallback: 'product' }),
        request,
        routeId: '/products',
      }),
    ]);

    expect(rootData).toEqual({ shell: true });
    expect(productData).toEqual({ product: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.headers.get('x-rsc-tree')).toBe(
      'true',
    );
    expect(decodeMock).toHaveBeenCalledTimes(1);
  });

  test('separates RSC payload cache entries by forwarded request headers', async () => {
    const payloadByUser: Record<string, unknown> = {
      alice: {
        type: 'render',
        actionData: null,
        errors: null,
        loaderData: {
          '/profile': { user: 'alice' },
        },
        location: { href: '/profile' },
        routes: [{ id: '/profile', hasLoader: true }],
      },
      bob: {
        type: 'render',
        actionData: null,
        errors: null,
        loaderData: {
          '/profile': { user: 'bob' },
        },
        location: { href: '/profile' },
        routes: [{ id: '/profile', hasLoader: true }],
      },
    };
    const fetchMock = rstest.fn(
      (_url: string | URL | Request, init?: RequestInit) => {
        const user =
          init?.headers instanceof Headers ? init.headers.get('x-user') : null;
        return Promise.resolve(
          new Response(JSON.stringify(payloadByUser[user || ''])),
        );
      },
    );
    rstest.stubGlobal('fetch', fetchMock);
    __setTanstackRscPayloadDecoderForTests(async stream =>
      JSON.parse(await new Response(stream).text()),
    );

    const [aliceData, bobData] = await Promise.all([
      loadTanstackRscRouteData({
        loadClientData: async () => ({ fallback: 'alice' }),
        request: new Request('http://localhost/profile', {
          headers: { 'x-user': 'alice' },
        }),
        routeId: '/profile',
      }),
      loadTanstackRscRouteData({
        loadClientData: async () => ({ fallback: 'bob' }),
        request: new Request('http://localhost/profile', {
          headers: { 'x-user': 'bob' },
        }),
        routeId: '/profile',
      }),
    ]);

    expect(aliceData).toEqual({ user: 'alice' });
    expect(bobData).toEqual({ user: 'bob' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('uses client loader data without requesting an RSC payload for client-loader routes', async () => {
    const fetchMock = rstest.fn();
    const loadClientData = rstest.fn(async () => ({ client: true }));
    rstest.stubGlobal('fetch', fetchMock);

    await expect(
      loadTanstackRscRouteData({
        hasClientLoader: true,
        loadClientData,
        request: new Request('http://localhost/client'),
        routeId: '/client',
      }),
    ).resolves.toEqual({ client: true });

    expect(loadClientData).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rethrows serialized notFound payload errors for the matched route', async () => {
    const payload = {
      type: 'render',
      actionData: null,
      errors: {
        '/missing': {
          isNotFound: true,
        },
      },
      loaderData: {},
      location: { href: '/missing' },
      routes: [{ id: '/missing', hasLoader: true }],
    };
    rstest.stubGlobal(
      'fetch',
      rstest.fn(() => Promise.resolve(new Response('payload'))),
    );
    __setTanstackRscPayloadDecoderForTests(async () => payload);

    await expect(
      loadTanstackRscRouteData({
        loadClientData: async () => ({ fallback: true }),
        request: new Request('http://localhost/missing'),
        routeId: '/missing',
      }),
    ).rejects.toMatchObject({
      isNotFound: true,
      routeId: '/missing',
    });
  });
});
