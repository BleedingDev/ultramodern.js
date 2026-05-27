import type { RouteObject } from '@modern-js/runtime-utils/router';
import type { NestedRoute } from '@modern-js/types';
import { createMemoryHistory } from '@tanstack/history';
import { createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import type { ComponentType } from 'react';
import { createElement, lazy } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createRouteTreeFromModernRoutes,
  createRouteTreeFromRouteObjects,
} from '../../src/runtime/routeTree';
import { __setTanstackRscPayloadDecoderForTests } from '../../src/runtime/rsc/payloadRouter';
import { createRouteObjectsFromConfig } from '../../src/runtime/utils';

type LoaderArgs = {
  params: Record<string, string>;
};

type TestRouteObject = RouteObject & {
  children?: TestRouteObject[];
  config?: {
    handle?: Record<string, unknown>;
  };
  hasAction?: boolean;
  hasClientLoader?: boolean;
  hasLoader?: boolean;
  inValidSSRRoute?: boolean;
  isClientComponent?: boolean;
  lazyImport?: () => Promise<{ default: ComponentType }>;
};

type TestNestedRoute = NestedRoute & {
  children?: TestNestedRoute[];
  hasAction?: boolean;
  hasClientLoader?: boolean;
  hasLoader?: boolean;
};

type ShouldRevalidateArgs = {
  nextUrl: URL;
};

type ShouldReloadArgs = {
  context: {
    request: Request;
  };
  location: {
    href: string;
  };
  params: Record<string, string>;
};

type TestRoute = {
  options: {
    shouldReload?: (args: ShouldReloadArgs) => boolean | undefined;
    ssr?: boolean;
    staticData: Record<string, unknown>;
  };
};

type TestRouter = {
  load: () => Promise<void>;
  looseRoutesById: Partial<Record<string, TestRoute>>;
  state: {
    matches: Array<{
      loaderData?: unknown;
      routeId: string;
    }>;
  };
};

type TestRouteTree = ReturnType<typeof createRouteTreeFromRouteObjects>;

async function loadRouteTree(
  routeTree: TestRouteTree,
  pathname: string,
): Promise<TestRouter> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [pathname],
    }),
    context: {
      request: new Request(`http://localhost${pathname}`),
      requestContext: {},
    },
  });

  await router.load();
  return router as unknown as TestRouter;
}

function getLooseRoute(router: TestRouter, id: string): TestRoute {
  const route = router.looseRoutesById[id];
  if (!route) {
    throw new Error(`Expected TanStack route ${id} to exist`);
  }
  return route;
}

function getLooseRouteByModernRouteId(
  router: TestRouter,
  modernRouteId: string,
): TestRoute {
  const route = Object.values(router.looseRoutesById).find(
    route => route?.options.staticData?.modernRouteId === modernRouteId,
  );
  if (!route) {
    throw new Error(`Expected Modern route ${modernRouteId} to exist`);
  }
  return route;
}

describe('tanstack route tree from RouteObject[]', () => {
  afterEach(() => {
    __setTanstackRscPayloadDecoderForTests();
    rstest.restoreAllMocks();
  });

  test('maps root loader and dynamic params', async () => {
    const routes: RouteObject[] = [
      {
        id: 'root',
        path: '/',
        loader: () => ({ root: 'ok' }),
        Component: () => null,
        children: [
          {
            id: 'user',
            path: 'user/:id',
            loader: ({ params }: LoaderArgs) => ({ id: params.id }),
            Component: () => null,
          },
        ],
      },
    ];

    const routeTree = createRouteTreeFromRouteObjects(routes);
    const router = await loadRouteTree(routeTree, '/user/123');

    const rootMatch = router.state.matches.find(
      match => match.routeId === '__root__',
    );
    const userMatch = router.state.matches.find(
      match => match.routeId === '/user/$id',
    );

    expect(rootMatch?.loaderData).toEqual({ root: 'ok' });
    expect(userMatch?.loaderData).toEqual({ id: '123' });
  });

  test('uses TanStack route ids when loading RSC payload route data', async () => {
    const rootLoader = rstest.fn(() => ({ source: 'modern-root' }));
    const userLoader = rstest.fn(() => ({ source: 'modern-user' }));
    const routes: RouteObject[] = [
      {
        id: 'root',
        path: '/',
        loader: rootLoader,
        Component: () => null,
        children: [
          {
            id: 'user',
            path: 'user/:id',
            loader: userLoader,
            Component: () => null,
          },
        ],
      },
    ];
    const payload = {
      type: 'render',
      actionData: null,
      errors: null,
      loaderData: {
        __root__: { source: 'rsc-root' },
        '/user/$id': { source: 'rsc-user' },
      },
      location: { href: '/user/123' },
      routes: [
        { id: '__root__', hasLoader: true },
        { id: '/user/$id', hasLoader: true },
      ],
    };
    const fetchMock = rstest.fn(() => Promise.resolve(new Response('payload')));
    const decodeMock = rstest.fn(async () => payload);
    rstest.stubGlobal('fetch', fetchMock);
    rstest.stubGlobal('window', { origin: 'http://localhost' });
    __setTanstackRscPayloadDecoderForTests(decodeMock);

    const routeTree = createRouteTreeFromRouteObjects(routes, {
      rscPayloadRouter: true,
    });
    const router = await loadRouteTree(routeTree, '/user/123');

    const rootMatch = router.state.matches.find(
      match => match.routeId === '__root__',
    );
    const userMatch = router.state.matches.find(
      match => match.routeId === '/user/$id',
    );
    expect(rootMatch?.loaderData).toEqual({ source: 'rsc-root' });
    expect(userMatch?.loaderData).toEqual({ source: 'rsc-user' });
    expect(rootLoader).not.toHaveBeenCalled();
    expect(userLoader).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(decodeMock).toHaveBeenCalledTimes(1);
  });

  test('maps splat params', async () => {
    let splatParamValue = '';
    const routes: TestRouteObject[] = [
      {
        id: 'root',
        path: '/',
        Component: () => null,
        children: [
          {
            id: 'files',
            path: 'files/*',
            loader: ({ params }: LoaderArgs) => {
              splatParamValue = String(params['*'] || '');
              return { value: params['*'] };
            },
            Component: () => null,
          },
        ],
      },
    ];

    const routeTree = createRouteTreeFromRouteObjects(routes);

    const splatRouter = await loadRouteTree(routeTree, '/files/a/b/c');
    const filesMatch = splatRouter.state.matches.find(
      match => match.routeId === '/files/$',
    );
    expect(filesMatch?.loaderData).toEqual({ value: 'a/b/c' });
    expect(splatParamValue).toBe('a/b/c');
  });

  test('preloads lazy Modern route components for server rendering', async () => {
    const LazyRouteComponent = () =>
      createElement('main', null, 'Lazy route ready');
    const lazyImport = rstest.fn(async () => ({
      default: LazyRouteComponent,
    }));
    const routes: TestRouteObject[] = [
      {
        id: 'root',
        path: '/',
        Component: () => null,
        children: [
          {
            id: 'lazy',
            path: 'lazy',
            Component: lazy(lazyImport),
            lazyImport,
          },
        ],
      },
    ];

    const routeTree = createRouteTreeFromRouteObjects(routes);
    const router = await loadRouteTree(routeTree, '/lazy');
    const lazyRoute = getLooseRoute(router, '/lazy');
    const component = lazyRoute.options.component as ComponentType & {
      preload?: () => Promise<unknown>;
    };

    await component.preload?.();

    expect(renderToStaticMarkup(createElement(component))).toContain(
      'Lazy route ready',
    );
    expect(lazyImport).toHaveBeenCalled();
  });

  test('renders preloaded lazy child routes through TanStack router SSR', async () => {
    const LazyRouteComponent = () =>
      createElement('main', null, 'Lazy child route ready');
    const lazyImport = rstest.fn(async () => ({
      default: LazyRouteComponent,
    }));
    const routes: TestRouteObject[] = [
      {
        id: 'root',
        path: '/',
        Component: () => createElement('section', null, createElement(Outlet)),
        children: [
          {
            id: 'lazy',
            path: 'lazy',
            Component: lazy(lazyImport),
            lazyImport,
          },
        ],
      },
    ];

    const routeTree = createRouteTreeFromRouteObjects(routes);
    const router = await loadRouteTree(routeTree, '/lazy');

    expect(
      renderToStaticMarkup(createElement(RouterProvider, { router } as never)),
    ).toContain('Lazy child route ready');
  });

  test('preserves route handle and maps shouldRevalidate to shouldReload', async () => {
    const shouldRevalidate = rstest.fn(({ nextUrl }: ShouldRevalidateArgs) =>
      nextUrl.pathname.endsWith('/456'),
    );
    const routes: RouteObject[] = [
      {
        id: 'root',
        path: '/',
        config: {
          handle: {
            shell: true,
          },
        },
        Component: () => null,
        children: [
          {
            id: 'user',
            path: 'user/:id',
            handle: { auth: true },
            config: {
              handle: {
                role: 'admin',
              },
            },
            shouldRevalidate,
            loader: ({ params }: LoaderArgs) => ({ id: params.id }),
            Component: () => null,
          },
        ],
      },
    ];

    const routeTree = createRouteTreeFromRouteObjects(routes);
    const router = await loadRouteTree(routeTree, '/user/123');
    const userRoute = getLooseRoute(router, '/user/$id');

    expect(routeTree.options.staticData.modernRouteHandle).toEqual({
      shell: true,
    });
    expect(userRoute.options.staticData.modernRouteHandle).toEqual({
      auth: true,
      role: 'admin',
    });
    expect(userRoute.options.staticData.modernRouteShouldRevalidate).toBe(
      shouldRevalidate,
    );
    expect(
      userRoute.options.shouldReload?.({
        location: { href: '/user/456' },
        params: { id: '456' },
        context: {
          request: new Request('http://localhost/user/456'),
        },
      }),
    ).toBe(true);
    expect(shouldRevalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        currentParams: { id: '123' },
        nextParams: { id: '456' },
      }),
    );
  });

  test('preserves client route metadata and disables invalid SSR routes', async () => {
    const routes: TestRouteObject[] = [
      {
        id: 'root',
        path: '/',
        Component: () => null,
        children: [
          {
            id: 'client',
            path: 'client',
            hasAction: true,
            hasClientLoader: true,
            hasLoader: true,
            inValidSSRRoute: true,
            isClientComponent: true,
            loader: () => ({ ok: true }),
            Component: () => null,
          },
        ],
      },
    ];

    const routeTree = createRouteTreeFromRouteObjects(routes);
    const router = await loadRouteTree(routeTree, '/client');
    const clientRoute = getLooseRoute(router, '/client');

    expect(clientRoute.options.ssr).toBe(false);
    expect(clientRoute.options.staticData).toMatchObject({
      modernRouteHasAction: true,
      modernRouteHasClientLoader: true,
      modernRouteHasLoader: true,
      modernRouteIsClientComponent: true,
    });
  });

  test('normalizes Modern deferred loader data for TanStack SSR', async () => {
    const routes: TestRouteObject[] = [
      {
        id: 'root',
        path: '/',
        Component: () => null,
        children: [
          {
            id: 'deferred',
            path: 'deferred',
            loader: () => ({
              __modern_deferred: true,
              data: {
                immediate: 'ok',
                later: Promise.resolve('done'),
              },
            }),
            Component: () => null,
          },
        ],
      },
    ];

    const routeTree = createRouteTreeFromRouteObjects(routes);
    const router = await loadRouteTree(routeTree, '/deferred');
    const deferredMatch = router.state.matches.find(
      match => match.routeId === '/deferred',
    );
    const loaderData = deferredMatch?.loaderData as
      | { immediate: string; later: Promise<string> }
      | undefined;

    expect(loaderData?.immediate).toBe('ok');
    await expect(loaderData?.later).resolves.toBe('done');
  });

  test('merges Modern generated route handle into TanStack static data', () => {
    const modernRoutes: NestedRoute[] = [
      {
        type: 'nested',
        origin: 'config',
        id: 'root',
        isRoot: true,
        config: {
          handle: {
            shell: true,
          },
        },
        children: [
          {
            type: 'nested',
            origin: 'config',
            id: 'dashboard',
            path: 'dashboard',
            handle: {
              section: 'analytics',
            },
            config: {
              handle: {
                role: 'admin',
              },
            },
          },
        ],
      },
    ];
    const routeTree = createRouteTreeFromModernRoutes(modernRoutes);
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({
        initialEntries: ['/dashboard'],
      }),
      context: {},
    }) as unknown as TestRouter;
    const dashboardRoute = getLooseRoute(router, '/dashboard');

    expect(routeTree.options.staticData.modernRouteHandle).toEqual({
      shell: true,
    });
    expect(dashboardRoute.options.staticData.modernRouteHandle).toEqual({
      section: 'analytics',
      role: 'admin',
    });
  });

  test('preserves Modern generated client route metadata', () => {
    const modernRoutes: TestNestedRoute[] = [
      {
        type: 'nested',
        origin: 'config',
        id: 'root',
        isRoot: true,
        children: [
          {
            type: 'nested',
            origin: 'config',
            id: 'client',
            path: 'client',
            clientData: './client.data',
            hasAction: true,
            hasClientLoader: true,
            hasLoader: true,
            inValidSSRRoute: true,
            isClientComponent: true,
          },
        ],
      },
    ];
    const routeTree = createRouteTreeFromModernRoutes(modernRoutes);
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({
        initialEntries: ['/client'],
      }),
      context: {},
    }) as unknown as TestRouter;
    const clientRoute = getLooseRouteByModernRouteId(router, 'client');

    expect(clientRoute.options.ssr).toBe(false);
    expect(clientRoute.options.staticData).toMatchObject({
      modernRouteHasAction: true,
      modernRouteHasClientLoader: true,
      modernRouteHasLoader: true,
      modernRouteIsClientComponent: true,
    });
  });

  test('preserves generated client metadata through RouteObject conversion', () => {
    const modernRoutes: TestNestedRoute[] = [
      {
        type: 'nested',
        origin: 'config',
        id: 'root',
        isRoot: true,
        children: [
          {
            type: 'nested',
            origin: 'config',
            id: 'client',
            path: 'client',
            clientData: './client.data',
            data: './data',
            inValidSSRRoute: true,
            isClientComponent: true,
          },
        ],
      },
    ];
    const routeObjects = createRouteObjectsFromConfig({
      routesConfig: { routes: modernRoutes },
    });
    const routeTree = createRouteTreeFromRouteObjects(routeObjects || []);
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({
        initialEntries: ['/client'],
      }),
      context: {},
    }) as unknown as TestRouter;
    const clientRoute = getLooseRouteByModernRouteId(router, 'client');

    expect(clientRoute.options.ssr).toBe(false);
    expect(clientRoute.options.staticData).toMatchObject({
      modernRouteHasClientLoader: true,
      modernRouteIsClientComponent: true,
    });
  });
});
