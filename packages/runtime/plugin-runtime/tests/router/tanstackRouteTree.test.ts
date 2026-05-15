import type { RouteObject } from '@modern-js/runtime-utils/router';
import type { NestedRoute } from '@modern-js/types';
import { createMemoryHistory } from '@tanstack/history';
import { createRouter } from '@tanstack/react-router';
import {
  createRouteTreeFromModernRoutes,
  createRouteTreeFromRouteObjects,
} from '../../src/router/runtime/tanstack/routeTree';
import { createRouteObjectsFromConfig } from '../../src/router/runtime/utils';

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

  test('maps splat params', async () => {
    let splatParamValue = '';
    const routes: RouteObject[] = [
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

  test('preserves route handle and maps shouldRevalidate to shouldReload', async () => {
    const shouldRevalidate = rstest.fn(({ nextUrl }: ShouldRevalidateArgs) =>
      nextUrl.pathname.endsWith('/456'),
    );
    const routes: TestRouteObject[] = [
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
