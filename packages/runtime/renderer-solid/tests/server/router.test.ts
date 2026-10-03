import type {
  DataOutcome,
  FileSystemRouteIR,
} from '@modern-js/renderer-core/data';
import {
  ApplicationRouter,
  createApplicationRouter,
  createFileSystemRouteTree,
  createMemoryHistory,
  createRootRoute,
  isNotFound,
  isRedirect,
  RouteDataError,
  resolveRouteData,
  selectApplicationDataRoute,
} from '../../src/router';

const routes: FileSystemRouteIR[] = [
  {
    id: 'layout',
    isRoot: true,
    modules: { data: '/layout.data.ts' },
    children: [
      {
        id: 'pathless',
        children: [
          {
            id: 'item',
            path: 'items/:itemId',
            modules: { data: '/item.data.ts' },
            children: [],
          },
          {
            id: 'optional',
            path: 'optional/:value?',
            children: [],
          },
          {
            id: 'splat',
            path: 'files/*',
            children: [],
          },
        ],
      },
    ],
  },
];

const metadata = {
  status: 200,
  statusText: 'OK',
  headers: [],
  cachePolicy: 'no-store',
} as const;

function routerAt(
  path: string,
  options: Parameters<typeof createFileSystemRouteTree>[2] = {},
) {
  return createApplicationRouter({
    routeTree: createFileSystemRouteTree(routes, {}, options),
    history: createMemoryHistory({ initialEntries: [path] }),
    isServer: true,
  });
}

describe('native Solid filesystem routing and data', () => {
  test.each([
    'loader',
    'beforeLoad',
    'context',
  ] as const)('custom native %s routes fail the immutable application profile before execution', operation => {
    const callback = rstest.fn(() => ({ private: 'not-public-data' }));
    const root = createRootRoute({ [operation]: callback });
    expect(() =>
      createApplicationRouter({
        routeTree: root,
        history: createMemoryHistory({ initialEntries: ['/'] }),
        isServer: true,
      }),
    ).toThrow('use createFileSystemRouteTree');
    expect(callback).not.toHaveBeenCalled();
  });

  test('managed public router options are cloned and immutable without freezing the author', () => {
    const shared = { value: 'public' };
    const context = { left: shared, right: shared };
    const router = routerAt('/items/42');
    const managed = createApplicationRouter({
      routeTree: createFileSystemRouteTree(routes, {}),
      history: createMemoryHistory({ initialEntries: ['/items/42'] }),
      context,
      isServer: true,
    });
    expect(managed.options.context).not.toBe(context);
    expect(managed.options.context?.left).toBe(managed.options.context?.right);
    expect(Object.isFrozen(managed.options.context)).toBe(true);
    expect(Object.isFrozen(managed.options.context?.left)).toBe(true);
    expect(Object.isFrozen(context)).toBe(false);
    expect(Object.isFrozen(shared)).toBe(false);
    shared.value = 'changed-author';
    expect(managed.options.context?.left.value).toBe('public');
    expect(router.matchRoutes('/items/42')).toHaveLength(3);
  });

  test('provider context overrides reject before any getter or native options update', () => {
    const router = routerAt('/items/42');
    const context = router.options.context;
    let reads = 0;
    const props = Object.defineProperty({ router }, 'context', {
      get() {
        reads++;
        return { private: 'not-public-data' };
      },
    });
    expect(() => ApplicationRouter(props)).toThrow(
      'ApplicationRouter context overrides are unsupported',
    );
    expect(reads).toBe(0);
    expect(router.options.context).toBe(context);
  });

  test.each([
    'loader',
  ] as const)('undeclared native %s module callbacks cannot bypass the managed data boundary', operation => {
    const callback = rstest.fn(() => ({ private: 'not-public-data' }));
    const module = { component: () => undefined, [operation]: callback };
    expect(() => createFileSystemRouteTree(routes, { layout: module })).toThrow(
      'Unsupported native Solid filesystem route option',
    );
    expect(callback).not.toHaveBeenCalled();
  });

  test('native matching retains layouts, pathless routes and dynamic params', () => {
    const router = routerAt('/items/42');
    const matches = router.matchRoutes('/items/42');
    expect(
      matches.map(
        match => router.routesById[match.routeId]?.options.staticData,
      ),
    ).toEqual([
      { ultramodernRouteId: 'layout' },
      { ultramodernRouteId: 'pathless' },
      { ultramodernRouteId: 'item' },
    ]);
    expect(matches.at(-1)?.params).toEqual({ itemId: '42' });
    expect(router.matchRoutes('/optional').at(-1)?.params).toEqual({
      value: undefined,
    });
    expect(router.matchRoutes('/files/a/b').at(-1)?.params._splat).toBe('a/b');
  });

  test('the native router invokes root and page loaders with per-request context', async () => {
    const context = { requestId: 'first' };
    const outcomes: string[] = [];
    const calls: { routeId: string; context: unknown; request: Request }[] = [];
    const router = routerAt('/items/42', {
      request: new Request('http://localhost/items/42?color=green', {
        headers: { 'x-request-id': 'first' },
      }),
      context,
      loadRoute: async (_route, input) => {
        calls.push(input);
        return { kind: 'success', value: input.params, status: 200 };
      },
      onOutcome: routeId => outcomes.push(routeId),
    });
    await router.load();
    expect(calls.map(call => call.routeId).sort()).toEqual(['item', 'layout']);
    expect(outcomes.sort()).toEqual(['item', 'layout']);
    expect(calls.every(call => call.context === context)).toBe(true);
    expect(
      calls.every(call => call.request.headers.get('x-request-id') === 'first'),
    ).toBe(true);
    expect(router.state.matches.at(-1)?.loaderData).toEqual({ itemId: '42' });
  });

  test('native search validation consumes an isolated checked public result', async () => {
    const nested = { color: 'green' };
    const authored = { nested };
    const validateSearch = rstest.fn(() => authored);
    const router = createApplicationRouter({
      routeTree: createFileSystemRouteTree(routes, {
        item: { validateSearch },
      }),
      history: createMemoryHistory({
        initialEntries: ['/items/42?nested=%7B%22color%22%3A%22green%22%7D'],
      }),
      isServer: true,
    });
    await router.load();
    const search = router.state.matches.at(-1)?.search;
    expect(router.state.matches.at(-1)?.error).toBeUndefined();
    expect(search).toEqual({ nested: { color: 'green' } });
    expect(validateSearch).toHaveBeenCalled();
    expect(search?.nested).toEqual({ color: 'green' });
    expect(search?.nested).not.toBe(nested);
    expect(Object.isFrozen(search?.nested)).toBe(true);
    expect(Object.isFrozen(authored)).toBe(false);
    expect(Object.isFrozen(nested)).toBe(false);
    nested.color = 'changed-author';
    expect(search?.nested).toEqual({ color: 'green' });
  });

  test('a data route must belong to the native matched chain', () => {
    const router = routerAt('/items/42');
    const loader = rstest.fn();
    const action = rstest.fn();
    const handlers = {
      item: { loader, action },
      layout: { loader },
      unrelated: { loader },
    };
    const request = new Request('http://localhost/items/42?__loader=item');
    expect(
      selectApplicationDataRoute(router, request, 'item', 'loader', handlers),
    ).toEqual({ routeId: 'item', params: { itemId: '42' }, handler: loader });
    expect(
      selectApplicationDataRoute(router, request, 'item', 'action', handlers)
        ?.handler,
    ).toBe(action);
    expect(
      selectApplicationDataRoute(router, request, 'layout', 'action', handlers),
    ).toBeUndefined();
    expect(
      selectApplicationDataRoute(
        router,
        request,
        'unrelated',
        'loader',
        handlers,
      ),
    ).toBeUndefined();
    expect(loader).not.toHaveBeenCalled();
  });

  test('duplicate filesystem ids fail before native matching', () => {
    expect(() =>
      createFileSystemRouteTree(
        [
          {
            id: 'same',
            path: '/one',
            children: [],
          },
          {
            id: 'same',
            path: '/two',
            children: [],
          },
        ],
        {},
      ),
    ).toThrow('Duplicate filesystem route id');
  });

  test('HTTP redirects preserve native status, external location and repeated cookies', () => {
    let result: unknown;
    try {
      resolveRouteData('item', {
        kind: 'redirect',
        location: 'https://example.test/next',
        response: {
          ...metadata,
          status: 303,
          headers: [
            ['set-cookie', 'one=1'],
            ['set-cookie', 'two=2'],
          ],
        },
      });
    } catch (error) {
      result = error;
    }
    expect(isRedirect(result)).toBe(true);
    expect((result as Response).status).toBe(303);
    expect((result as Response).headers.get('location')).toBe(
      'https://example.test/next',
    );
    expect((result as Response).headers.getSetCookie()).toEqual([
      'one=1',
      'two=2',
    ]);
  });

  test('not-found and public action errors enter the native boundaries', () => {
    let result: unknown;
    try {
      resolveRouteData('item', {
        kind: 'not-found',
        value: { missing: '42' },
        thrown: false,
        status: 404,
      });
    } catch (error) {
      result = error;
    }
    expect(isNotFound(result)).toBe(true);
    try {
      resolveRouteData('item', {
        kind: 'error',
        error: { name: 'ValidationError', message: 'Required' },
        data: { field: 'name' },
        thrown: false,
        status: 422,
      });
    } catch (error) {
      result = error;
    }
    expect(result).toBeInstanceOf(RouteDataError);
    expect(result).toMatchObject({
      routeId: 'item',
      status: 422,
      name: 'ValidationError',
      data: { field: 'name' },
    });
  });

  test('deferred route values stay native promises for loading and serialization', async () => {
    const deferred = Promise.resolve('later');
    const outcome: DataOutcome = {
      kind: 'deferred',
      critical: { now: 'ready' },
      deferred: { later: deferred },
      response: { ...metadata, headers: [] },
    };
    const value = resolveRouteData('item', outcome) as {
      now: string;
      later: Promise<string>;
    };
    expect(value.now).toBe('ready');
    expect(value.later).toBe(deferred);
    await expect(value.later).resolves.toBe('later');
  });
});
