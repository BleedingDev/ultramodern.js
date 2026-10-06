import { describe, expect, it } from '@rstest/core';
import type { DataOutcome, FileSystemRouteIR } from '../../src/data';
import { DataProtocolError } from '../../src/data';
import {
  loadFileSystemRoute,
  matchApplicationRouteIds,
  matchApplicationRoutes,
  type NativeHistoryLocation,
  nativeRoutePath,
  RouteDataError,
  resolveRouteData,
  selectApplicationDataRoute,
  splitFileSystemRoutes,
} from '../../src/router';

const metadata = {
  status: 200,
  statusText: 'OK',
  headers: [],
  cachePolicy: 'no-store',
} as const;

const signals = {
  redirect: (options: object) => ({ redirect: options }),
  notFound: (options: object) => ({ notFound: options }),
};

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('Expected a thrown route outcome');
}

function route(
  id: string,
  extra: Partial<FileSystemRouteIR> = {},
): FileSystemRouteIR {
  return { id, children: [], ...extra };
}

/** A basepath-aware matcher with the native router's routesById shape. */
function fakeRouter(basepath = '') {
  const parsed: NativeHistoryLocation[] = [];
  const table: Record<
    string,
    { routeId: string; params: Record<string, string> }[]
  > = {
    '/items/42': [
      { routeId: '__root__', params: {} },
      { routeId: '/_pathless', params: {} },
      { routeId: '/items/$itemId', params: { itemId: '42' } },
    ],
  };
  return {
    parsed,
    routesById: {
      __root__: { options: { staticData: { ultramodernRouteId: 'layout' } } },
      '/_pathless': {
        options: { staticData: { ultramodernRouteId: 'pathless' } },
      },
      '/items/$itemId': {
        options: { staticData: { ultramodernRouteId: 'item' } },
      },
    },
    parseLocation(location: NativeHistoryLocation) {
      parsed.push(location);
      return location.pathname.startsWith(basepath)
        ? location.pathname.slice(basepath.length) || '/'
        : undefined;
    },
    matchRoutes(pathname: string | undefined) {
      return (pathname && table[pathname]) || [];
    },
  };
}

describe('native router glue', () => {
  it('matches the public URL through the router location parser', () => {
    const router = fakeRouter('/admin');
    const matches = matchApplicationRoutes(
      router,
      new URL('http://localhost/admin/items/42?sort=name#top'),
    );
    expect(matches.map(match => match.routeId)).toHaveLength(3);
    expect(router.parsed).toEqual([
      {
        href: '/admin/items/42?sort=name#top',
        pathname: '/admin/items/42',
        search: '?sort=name',
        hash: '#top',
        state: { __TSR_index: 0 },
      },
    ]);
  });

  it('names the filesystem routes a public URL matches', () => {
    const router = fakeRouter('/admin');
    expect(
      matchApplicationRouteIds(
        router,
        new URL('http://localhost/admin/items/42'),
      ),
    ).toEqual(['layout', 'pathless', 'item']);
    expect(
      matchApplicationRouteIds(router, new URL('http://localhost/items/42')),
    ).toEqual([]);
  });

  it('authorizes a data route only inside the matched chain', () => {
    const router = fakeRouter('/admin');
    const loader = () => undefined;
    const action = () => undefined;
    const handlers = {
      item: { loader, action },
      layout: { loader },
      unrelated: { loader },
    };
    const request = new Request(
      'http://localhost/admin/items/42?__loader=item',
    );
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
    expect(
      selectApplicationDataRoute(
        router,
        new Request('http://localhost/items/42?__loader=item'),
        'item',
        'loader',
        handlers,
      ),
    ).toBeUndefined();
  });

  it('redirects keep their status, location and repeated cookies', () => {
    expect(
      thrown(() =>
        resolveRouteData(signals, 'item', {
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
        }),
      ),
    ).toEqual({
      redirect: {
        href: 'https://example.test/next',
        statusCode: 303,
        headers: [
          ['set-cookie', 'one=1'],
          ['set-cookie', 'two=2'],
        ],
      },
    });
    expect(
      thrown(() =>
        resolveRouteData(signals, 'item', {
          kind: 'redirect',
          location: '/sign-in',
          status: 307,
        }),
      ),
    ).toEqual({ redirect: { href: '/sign-in', statusCode: 307 } });
  });

  it('not-found and errors enter the native boundaries through the projection', () => {
    const project = (value: unknown) =>
      value && typeof value === 'object'
        ? { ...value, projected: true }
        : value;
    expect(
      thrown(() =>
        resolveRouteData(
          signals,
          'item',
          {
            kind: 'not-found',
            value: { missing: '42' },
            thrown: false,
            status: 404,
          },
          project,
        ),
      ),
    ).toEqual({ notFound: { data: { missing: '42', projected: true } } });
    const error = thrown(() =>
      resolveRouteData(
        signals,
        'item',
        {
          kind: 'error',
          error: { name: 'ValidationError', message: 'Required' },
          data: { field: 'name' },
          thrown: false,
          status: 422,
        },
        project,
      ),
    );
    expect(error).toBeInstanceOf(RouteDataError);
    expect(Object.isFrozen(error)).toBe(true);
    expect(error).toMatchObject({
      routeId: 'item',
      status: 422,
      name: 'ValidationError',
      message: 'Required',
      data: { field: 'name', projected: true },
    });
    expect(
      thrown(() =>
        resolveRouteData(
          signals,
          'item',
          {
            kind: 'error',
            error: { name: 'ValidationError', message: 'Required' },
            thrown: false,
            status: 422,
          },
          () => undefined,
        ),
      ),
    ).toBeInstanceOf(DataProtocolError);
  });

  it('deferred values stay native promises for loading and serialization', async () => {
    const deferred = Promise.resolve('later');
    const outcome: DataOutcome = {
      kind: 'deferred',
      critical: { now: 'ready' },
      deferred: { later: deferred },
      response: metadata,
    };
    const value = resolveRouteData(signals, 'item', outcome) as {
      now: string;
      later: Promise<string>;
    };
    expect(value.now).toBe('ready');
    expect(value.later).toBe(deferred);
    await expect(value.later).resolves.toBe('later');
  });

  it('validates the filesystem shape before native factories run', () => {
    const root = route('root', {
      isRoot: true,
      children: [route('home', { index: true })],
    });
    expect(
      splitFileSystemRoutes([root, route('outside', { path: '/x' })]),
    ).toEqual({
      root,
      children: [root.children[0], route('outside', { path: '/x' })],
    });
    expect(() => splitFileSystemRoutes([route('a'), route('a')])).toThrow(
      'Duplicate filesystem route id: a',
    );
    expect(() =>
      splitFileSystemRoutes([
        route('root', { isRoot: true }),
        route('other', { isRoot: true }),
      ]),
    ).toThrow('one application root');
    expect(() =>
      splitFileSystemRoutes([
        route('layout', { children: [route('nested', { isRoot: true })] }),
      ]),
    ).toThrow('cannot be a child route');
  });

  it('projects filesystem paths into native path options', () => {
    expect(nativeRoutePath(route('home', { index: true }))).toEqual({
      path: '/',
    });
    expect(nativeRoutePath(route('item', { path: 'items/:id?' }))).toEqual({
      path: 'items/{-$id}',
    });
    expect(nativeRoutePath(route('pathless'))).toEqual({ id: 'pathless' });
  });

  it('loads route data under the public URL and both abort owners', async () => {
    const owner = new AbortController();
    const request = new Request('http://localhost/admin/items/42?sort=name', {
      headers: { 'x-request-id': 'first' },
      signal: owner.signal,
    });
    const context = { tenant: 'tractor' };
    const abortController = new AbortController();
    let input:
      | Parameters<Parameters<typeof loadFileSystemRoute>[1]>[1]
      | undefined;
    const loaded = await loadFileSystemRoute(
      route('item', { path: 'items/:id' }),
      async (_route, received) => {
        input = received;
        return { kind: 'success', value: 1, status: 200 };
      },
      { request, context },
      {
        params: { id: '42' },
        location: { publicHref: '/admin/items/42?sort=name' },
        abortController,
      },
    );
    expect(loaded.outcome).toEqual({ kind: 'success', value: 1, status: 200 });
    expect(input?.request.url).toBe(
      'http://localhost/admin/items/42?sort=name',
    );
    expect(input?.request.headers.get('x-request-id')).toBe('first');
    expect(input).toMatchObject({
      routeId: 'item',
      params: { id: '42' },
      context,
    });
    owner.abort();
    expect(loaded.signal.aborted).toBe(true);

    const cancelled = new AbortController();
    let observed = false;
    await expect(
      loadFileSystemRoute(
        route('item'),
        async () => {
          cancelled.abort();
          observed = true;
          return { kind: 'success', value: 'too late', status: 200 };
        },
        { request: new Request('http://localhost/item') },
        {
          params: {},
          location: { publicHref: '/item' },
          abortController: cancelled,
        },
      ),
    ).rejects.toThrow();
    expect(observed).toBe(true);
  });
});
