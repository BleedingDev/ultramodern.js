import type { RouteObject } from '@modern-js/runtime-utils/router';
import { createMemoryHistory } from '@tanstack/history';
import {
  createRouter,
  Outlet,
  RouterProvider,
  redirect,
} from '@tanstack/react-router';
import type { ComponentType } from 'react';
import { createElement, lazy } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { Outlet as ModernOutlet } from '../../src/runtime/outlet';
import { createRouteTreeFromRouteObjects } from '../../src/runtime/routeTree';

type LoaderArgs = { params: Record<string, string> };

type TestRouteObject = RouteObject & {
  children?: TestRouteObject[];
  lazyImport?: () => Promise<unknown>;
};

type TestRouter = {
  _serverResult?:
    | { type: 'redirect'; redirect: Response }
    | { type: 'render'; status: number };
  state: {
    matches: Array<{ error?: unknown; loaderData?: unknown; routeId: string }>;
  };
};

const nullComponent = () => null;

const root = (
  children: TestRouteObject[],
  Component: RouteObject['Component'] = nullComponent,
): TestRouteObject[] => [{ id: 'root', path: '/', Component, children }];

async function loadRouteTree(
  routes: TestRouteObject[],
  pathname: string,
): Promise<TestRouter> {
  const router = createRouter({
    routeTree: createRouteTreeFromRouteObjects(routes as RouteObject[]),
    history: createMemoryHistory({ initialEntries: [pathname] }),
    context: {
      request: new Request(`http://localhost${pathname}`),
      requestContext: {},
    },
  });

  await router.load();
  return router as unknown as TestRouter;
}

const matchOf = (router: TestRouter, routeId: string) =>
  router.state.matches.find(match => match.routeId === routeId);

describe('tanstack route tree from RouteObject[]', () => {
  test('resolves loader data for root, dynamic and splat params', async () => {
    const routes: TestRouteObject[] = root(
      [
        {
          id: 'user',
          path: 'user/:id',
          loader: ({ params }: LoaderArgs) => ({ id: params.id }),
          Component: nullComponent,
        },
        {
          id: 'files',
          path: 'files/*',
          loader: ({ params }: LoaderArgs) => ({ value: params['*'] }),
          Component: nullComponent,
        },
      ],
      nullComponent,
    );
    routes[0].loader = () => ({ root: 'ok' });

    const userRouter = await loadRouteTree(routes, '/user/123');
    expect(matchOf(userRouter, '__root__')?.loaderData).toEqual({ root: 'ok' });
    expect(matchOf(userRouter, '/user/$id')?.loaderData).toEqual({ id: '123' });

    const splatRouter = await loadRouteTree(routes, '/files/a/b/c');
    expect(matchOf(splatRouter, '/files/$')?.loaderData).toEqual({
      value: 'a/b/c',
    });
  });

  test('keeps unnamed sibling pathless layouts distinct', async () => {
    const pathless = (path: string): TestRouteObject => ({
      Component: nullComponent,
      children: [
        { path, loader: () => ({ value: path }), Component: nullComponent },
      ],
    });

    const router = await loadRouteTree(
      [pathless('alpha'), pathless('beta')],
      '/beta',
    );
    const loaderData = router.state.matches
      .map(match => match.loaderData)
      .filter(Boolean);

    expect(loaderData).toContainEqual({ value: 'beta' });
    expect(loaderData).not.toContainEqual({ value: 'alpha' });
  });

  describe('flat leaf that prefixes other routes', () => {
    const leaf = (id: string, path: string): TestRouteObject => ({
      id,
      path,
      loader: ({ params }: LoaderArgs) => ({ id, params }),
      Component: nullComponent,
    });
    const lastMatch = (router: TestRouter) => router.state.matches.at(-1);

    test('matches the leaf as the index of its prefix, not the sibling splat', async () => {
      const routes = root([
        leaf('lang/page', ':lang'),
        leaf('lang/$', ':lang/*'),
        leaf('lang/login/page', ':lang/login'),
        leaf('about/page', 'about'),
      ]);

      for (const [pathname, routeId, loaderData] of [
        ['/en', '/$lang/', { id: 'lang/page', params: { lang: 'en' } }],
        [
          '/en/login',
          '/$lang/login',
          { id: 'lang/login/page', params: { lang: 'en' } },
        ],
        [
          '/en/x/y',
          '/$lang/$',
          { id: 'lang/$', params: { lang: 'en', '*': 'x/y' } },
        ],
        ['/about', '/about', { id: 'about/page', params: {} }],
      ] as const) {
        const match = lastMatch(await loadRouteTree(routes, pathname));
        expect(match?.routeId).toBe(routeId);
        expect(match?.loaderData).toMatchObject(loaderData);
      }
    });

    test('treats routes under sibling pathless layouts as descendants', async () => {
      const pathless = (child: TestRouteObject): TestRouteObject => ({
        id: `${child.id}/layout`,
        Component: nullComponent,
        children: [child],
      });
      const routes = root([
        pathless(leaf('lang/page', ':lang')),
        pathless(leaf('lang/$', ':lang/*')),
      ]);

      const indexMatch = lastMatch(await loadRouteTree(routes, '/en'));
      expect(indexMatch?.routeId).toBe('/lang/page/layout/$lang/');
      expect(indexMatch?.loaderData).toMatchObject({ id: 'lang/page' });

      const splatMatch = lastMatch(await loadRouteTree(routes, '/en/x'));
      expect(splatMatch?.routeId).toBe('/lang/$/layout/$lang/$');
    });

    test('leaves a layout route with the same prefix as a layout', async () => {
      const routes = root([
        {
          id: 'lang/layout',
          path: ':lang',
          Component: () => createElement(Outlet),
          children: [leaf('lang/settings/page', 'settings')],
        },
        leaf('lang/$', ':lang/*'),
      ]);

      const router = await loadRouteTree(routes, '/en/settings');
      expect(router.state.matches.map(match => match.routeId)).toEqual([
        '__root__',
        '/$lang',
        '/$lang/settings',
      ]);
    });
  });

  test('reports native TanStack unknown routes as HTTP 404', async () => {
    const router = await loadRouteTree(
      root([{ id: 'known', path: 'known', Component: nullComponent }]),
      '/missing',
    );

    expect(router._serverResult).toMatchObject({ type: 'render', status: 404 });
  });

  test('reports native TanStack loader redirects as server responses', async () => {
    const router = await loadRouteTree(
      root([
        {
          id: 'redirect',
          path: 'redirect',
          loader: () => {
            throw redirect({ to: '/target' });
          },
          Component: nullComponent,
        },
        { id: 'target', path: 'target', Component: nullComponent },
      ]),
      '/redirect',
    );

    if (router._serverResult?.type !== 'redirect') {
      throw new Error('Expected a TanStack redirect server result');
    }
    expect(router._serverResult.redirect.status).toBe(307);
    expect(router._serverResult.redirect.headers.get('Location')).toBe(
      '/target',
    );
  });

  test('renders Modern Outlet through TanStack native outlet', async () => {
    const router = await loadRouteTree(
      root(
        [
          {
            id: 'plain',
            path: 'plain',
            Component: () => createElement('main', null, 'Plain child route'),
          },
        ],
        () => createElement('section', null, createElement(ModernOutlet)),
      ),
      '/plain',
    );

    expect(
      renderToString(createElement(RouterProvider, { router } as never)),
    ).toContain('Plain child route');
  });

  for (const [shape, wrap] of [
    ['flat', (Component: ComponentType) => ({ default: Component })],
    [
      'nested',
      (Component: ComponentType) => ({ default: { default: Component } }),
    ],
  ] as const) {
    test(`server renders lazy child routes from ${shape} ESM module defaults`, async () => {
      const LazyRouteComponent = () =>
        createElement('main', null, 'Lazy child route ready');
      const lazyImport = () => Promise.resolve(wrap(LazyRouteComponent));
      const router = await loadRouteTree(
        root(
          [
            {
              id: 'lazy',
              path: 'lazy',
              Component: lazy(
                lazyImport as () => Promise<{ default: ComponentType }>,
              ),
              lazyImport,
            },
          ],
          () => createElement('section', null, createElement(Outlet)),
        ),
        '/lazy',
      );

      expect(
        renderToStaticMarkup(
          createElement(RouterProvider, { router } as never),
        ),
      ).toContain('Lazy child route ready');
    });
  }

  test('normalizes Modern deferred loader data for TanStack SSR', async () => {
    const router = await loadRouteTree(
      root([
        {
          id: 'deferred',
          path: 'deferred',
          loader: () => ({
            __modern_deferred: true,
            data: { immediate: 'ok', later: Promise.resolve('done') },
          }),
          Component: nullComponent,
        },
      ]),
      '/deferred',
    );
    const loaderData = matchOf(router, '/deferred')?.loaderData as
      | { immediate: string; later: Promise<string> }
      | undefined;

    expect(loaderData?.immediate).toBe('ok');
    await expect(loaderData?.later).resolves.toBe('done');
  });

  test('preserves returned non-404 Response loaders as loader data', async () => {
    const response = new Response('route status payload', { status: 500 });
    const router = await loadRouteTree(
      root([
        {
          id: 'broken',
          path: 'broken',
          loader: () => response,
          Component: nullComponent,
        },
      ]),
      '/broken',
    );

    expect(router._serverResult).toMatchObject({ type: 'render', status: 200 });
    expect(matchOf(router, '/broken')?.loaderData).toBe(response);
    expect(matchOf(router, '/broken')?.error).toBeUndefined();
  });
});
