import type { RouteObject } from '@modern-js/runtime-utils/router';
import type { NestedRoute } from '@modern-js/types';
import { createMemoryHistory } from '@tanstack/history';
import { createRouter } from '@tanstack/react-router';
import {
  createRouteTreeFromModernRoutes,
  createRouteTreeFromRouteObjects,
} from '../../src/router/runtime/tanstack/routeTree';

type LoaderArgs = {
  params: Record<string, string>;
};

type TestRouteObject = RouteObject & {
  children?: TestRouteObject[];
  config?: {
    handle?: Record<string, unknown>;
  };
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
});
