import type React from 'react';
import { isValidElement } from 'react';
import { createRscProxy } from '../../src/runtime/rsc/createRscProxy';
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
