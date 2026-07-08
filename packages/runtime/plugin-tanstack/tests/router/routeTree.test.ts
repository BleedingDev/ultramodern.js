import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { RouteObject } from '@modern-js/runtime-utils/router';
import type { NestedRoute } from '@modern-js/types';
import { createMemoryHistory } from '@tanstack/history';
import { createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import type { ComponentType } from 'react';
import { createElement, lazy } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import * as TanstackRuntime from '../../src/runtime';
import { Outlet as PublicOutlet } from '../../src/runtime';
import { Outlet as ModernOutlet } from '../../src/runtime/outlet';
import {
  createRouteTreeFromRouteObjects,
  getModernRouteIdsFromMatches,
} from '../../src/runtime/routeTree';
import { __setTanstackRscPayloadDecoderForTests } from '../../src/runtime/rsc/payloadRouter';
import { createTanstackRouteObjectsFromConfig } from '../../src/runtime/utils';

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
  lazyImport?: () => Promise<unknown>;
  loaderDeps?: unknown;
  validateSearch?: unknown;
};

type TestNestedRoute = NestedRoute & {
  children?: TestNestedRoute[];
  hasAction?: boolean;
  hasClientLoader?: boolean;
  hasLoader?: boolean;
  loaderDeps?: unknown;
  validateSearch?: unknown;
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
    component?: unknown;
    shouldReload?: (args: ShouldReloadArgs) => boolean | undefined;
    ssr?: boolean;
    staticData: Record<string, unknown>;
    loaderDeps?: unknown;
    validateSearch?: unknown;
    wrapInSuspense?: unknown;
  };
};

type PreloadableTestComponent = {
  load?: () => Promise<unknown>;
  preload?: () => Promise<unknown>;
};

type TestRouter = {
  load: () => Promise<void>;
  looseRoutesById: Partial<Record<string, TestRoute>>;
  state: {
    matches: Array<{
      error?: unknown;
      loaderData?: unknown;
      routeId: string;
    }>;
    statusCode?: number;
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

function countCompletedSuspenseBoundaries(markup: string) {
  return markup.match(/<!--\$-->/g)?.length || 0;
}

describe('tanstack runtime public exports', () => {
  test('exports the Modern Outlet implementation from the runtime entrypoint', () => {
    expect(PublicOutlet).toBe(ModernOutlet);
  });

  test('does not expose the unowned composite RSC helper API', () => {
    expect('CompositeComponent' in TanstackRuntime).toBe(false);

    const packageJson = JSON.parse(
      readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'),
    ) as {
      exports: Record<string, unknown>;
      typesVersions?: Record<string, Record<string, string[]>>;
    };

    expect(packageJson.exports['./runtime/rsc']).toBeUndefined();
    expect(packageJson.exports['./runtime/rsc/client']).toBeDefined();
    expect(packageJson.exports['./runtime/rsc/server']).toBeDefined();
    expect(packageJson.typesVersions?.['*']?.['runtime/rsc']).toBeUndefined();
    expect(packageJson.typesVersions?.['*']?.['runtime/rsc/client']).toEqual([
      './dist/types/runtime/rsc/client.d.ts',
    ]);
    expect(packageJson.typesVersions?.['*']?.['runtime/rsc/server']).toEqual([
      './dist/types/runtime/rsc/server.d.ts',
    ]);
  });
});

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

  test('keeps unnamed sibling pathless layouts distinct', async () => {
    const routes: RouteObject[] = [
      {
        Component: () => null,
        children: [
          {
            path: 'alpha',
            loader: () => ({ value: 'alpha' }),
            Component: () => null,
          },
        ],
      },
      {
        Component: () => null,
        children: [
          {
            path: 'beta',
            loader: () => ({ value: 'beta' }),
            Component: () => null,
          },
        ],
      },
    ];

    const routeTree = createRouteTreeFromRouteObjects(routes);
    const router = await loadRouteTree(routeTree, '/beta');

    const matchedLoaderData = router.state.matches
      .map(match => match.loaderData)
      .filter(Boolean);

    expect(matchedLoaderData).toContainEqual({ value: 'beta' });
    expect(matchedLoaderData).not.toContainEqual({ value: 'alpha' });
  });

  test('reports native TanStack unknown routes as HTTP 404', async () => {
    const routes: RouteObject[] = [
      {
        id: 'root',
        path: '/',
        Component: () => null,
        children: [
          {
            id: 'known',
            path: 'known',
            Component: () => null,
          },
        ],
      },
    ];

    const routeTree = createRouteTreeFromRouteObjects(routes);
    const router = await loadRouteTree(routeTree, '/missing');

    expect(router.state.statusCode).toBe(404);
  });

  test('does not force Suspense wrappers for ordinary generated routes', async () => {
    const routes: RouteObject[] = [
      {
        id: 'root',
        path: '/',
        Component: () => createElement(Outlet),
        children: [
          {
            id: 'plain',
            path: 'plain',
            Component: () => null,
          },
        ],
      },
    ];

    const routeTree = createRouteTreeFromRouteObjects(routes);
    const router = await loadRouteTree(routeTree, '/plain');

    expect(routeTree.options.wrapInSuspense).toBeUndefined();
    expect(
      getLooseRoute(router, '/plain').options.wrapInSuspense,
    ).toBeUndefined();
  });

  test('renders Modern Outlet through TanStack native outlet', async () => {
    const routes: RouteObject[] = [
      {
        id: 'root',
        path: '/',
        Component: () =>
          createElement('section', null, createElement(ModernOutlet)),
        children: [
          {
            id: 'plain',
            path: 'plain',
            Component: () => createElement('main', null, 'Plain child route'),
          },
        ],
      },
    ];

    const routeTree = createRouteTreeFromRouteObjects(routes);
    const router = await loadRouteTree(routeTree, '/plain');
    const markup = renderToString(
      createElement(RouterProvider, { router } as never),
    );
    const suspenseBoundaryCount = countCompletedSuspenseBoundaries(markup);

    expect(markup).toContain('Plain child route');
    expect(suspenseBoundaryCount).toBe(1);
  });

  test('resolves matched Modern route ids from TanStack route registry fallback', () => {
    const router = {
      state: {
        matches: [
          { routeId: '__root__' },
          { routeId: '/$lang' },
          { routeId: '/$lang/tractors' },
          {
            route: {
              options: {
                staticData: {
                  modernRouteId: '(lang)/stores/page',
                },
              },
            },
            routeId: '/$lang/stores',
          },
        ],
      },
      routesById: {
        __root__: {
          options: {
            staticData: {
              modernRouteId: 'layout',
            },
          },
        },
        '/$lang': {
          options: {
            staticData: {
              modernRouteId: '(lang)/page',
            },
          },
        },
        '/$lang/tractors': {
          options: {
            staticData: {
              modernRouteId: '(lang)/tractors/page',
            },
          },
        },
      },
    };

    expect(getModernRouteIdsFromMatches(router as never)).toEqual([
      'layout',
      '(lang)/page',
      '(lang)/tractors/page',
      '(lang)/stores/page',
    ]);
  });

  test('preserves TanStack search contracts from RouteObject routes', () => {
    const rootValidateSearch = (search: unknown) => ({ root: search });
    const rootLoaderDeps = ({ search }: { search: unknown }) => ({ search });
    const childValidateSearch = (search: unknown) => ({ child: search });
    const childLoaderDeps = ({ search }: { search: unknown }) => ({ search });
    const routes: TestRouteObject[] = [
      {
        id: 'root',
        path: '/',
        validateSearch: rootValidateSearch,
        loaderDeps: rootLoaderDeps,
        Component: () => null,
        children: [
          {
            id: 'search',
            path: 'search',
            validateSearch: childValidateSearch,
            loaderDeps: childLoaderDeps,
            Component: () => null,
          },
        ],
      },
    ];

    const routeTree = createRouteTreeFromRouteObjects(routes);
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({
        initialEntries: ['/search'],
      }),
      context: {},
    }) as unknown as TestRouter;
    const searchRoute = getLooseRoute(router, '/search');

    expect(routeTree.options.validateSearch).toBe(rootValidateSearch);
    expect(routeTree.options.loaderDeps).toBe(rootLoaderDeps);
    expect(searchRoute.options.validateSearch).toBe(childValidateSearch);
    expect(searchRoute.options.loaderDeps).toBe(childLoaderDeps);
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
    const lazyRoute = getLooseRoute(router, '/lazy');
    const lazyComponent = lazyRoute.options
      .component as PreloadableTestComponent;

    expect(
      renderToStaticMarkup(createElement(RouterProvider, { router } as never)),
    ).toContain('Lazy child route ready');
    expect(typeof lazyComponent.load).toBe('function');
    expect(typeof lazyComponent.preload).toBe('function');
  });

  test('exposes load-only Modern route components through TanStack preload', async () => {
    const load = rstest.fn(async () => 'route chunk loaded');
    const LoadOnlyRouteComponent = (() =>
      createElement('main', null, 'Load-only route ready')) as ComponentType & {
      load?: () => Promise<unknown>;
      preload?: () => Promise<unknown>;
    };
    LoadOnlyRouteComponent.load = load;
    const routes: TestRouteObject[] = [
      {
        id: 'root',
        path: '/',
        Component: () => createElement('section', null, createElement(Outlet)),
        children: [
          {
            id: 'load-only',
            path: 'load-only',
            Component: LoadOnlyRouteComponent,
          },
        ],
      },
    ];

    const routeTree = createRouteTreeFromRouteObjects(routes);
    const router = await loadRouteTree(routeTree, '/load-only');
    const loadOnlyRoute = getLooseRoute(router, '/load-only');
    const loadOnlyComponent = loadOnlyRoute.options
      .component as PreloadableTestComponent;

    expect(typeof loadOnlyComponent.load).toBe('function');
    expect(typeof loadOnlyComponent.preload).toBe('function');
    expect(load).toHaveBeenCalledTimes(1);
    await loadOnlyComponent.preload?.();
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('unwraps nested ESM route module defaults before server rendering', async () => {
    const LazyRouteComponent = () =>
      createElement('main', null, 'Nested lazy child route ready');
    const lazyImport = rstest.fn(async () => ({
      default: {
        default: LazyRouteComponent,
      },
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
            Component: lazy(
              lazyImport as () => Promise<{ default: ComponentType }>,
            ),
            lazyImport,
          },
        ],
      },
    ];

    const routeTree = createRouteTreeFromRouteObjects(routes);
    const router = await loadRouteTree(routeTree, '/lazy');

    expect(
      renderToStaticMarkup(createElement(RouterProvider, { router } as never)),
    ).toContain('Nested lazy child route ready');
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

  test('preserves returned non-404 Response loaders as loader data', async () => {
    const response = new Response('route status payload', { status: 500 });
    const routes: TestRouteObject[] = [
      {
        id: 'root',
        path: '/',
        Component: () => null,
        children: [
          {
            id: 'broken',
            path: 'broken',
            loader: () => response,
            Component: () => null,
          },
        ],
      },
    ];

    const routeTree = createRouteTreeFromRouteObjects(routes);
    const router = await loadRouteTree(routeTree, '/broken');
    const brokenMatch = router.state.matches.find(
      match => match.routeId === '/broken',
    );

    expect(router.state.statusCode).toBe(200);
    expect(brokenMatch?.loaderData).toBe(response);
    expect(brokenMatch?.error).toBeUndefined();
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
    const routeObjects = createTanstackRouteObjectsFromConfig({
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

  test('does not copy hasErrorBoundary into React Router route objects', () => {
    function ErrorPage() {
      return null;
    }

    const modernRoutes: TestNestedRoute[] = [
      {
        type: 'nested',
        origin: 'config',
        id: 'root',
        isRoot: true,
        hasErrorBoundary: true,
        children: [
          {
            type: 'nested',
            origin: 'config',
            id: 'child',
            path: 'child',
            hasErrorBoundary: true,
            error: ErrorPage,
          },
        ],
      },
    ];

    const routeObjects = createTanstackRouteObjectsFromConfig({
      routesConfig: { routes: modernRoutes },
    });
    const rootRoute = routeObjects?.[0];
    const childRoute = rootRoute?.children?.[0];

    expect(rootRoute).not.toHaveProperty('hasErrorBoundary');
    expect(childRoute).not.toHaveProperty('hasErrorBoundary');
    expect(childRoute?.errorElement).toBeDefined();
  });
});
