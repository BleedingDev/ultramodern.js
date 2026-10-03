import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import {
  RouteActionResponseError,
  submitRouteAction,
} from '../../../packages/runtime/plugin-tanstack/src/runtime/submitAction';

type Handler = (args: {
  request: Request;
  params: Record<string, string>;
}) => unknown;

async function nativeRouter(action: Handler, modernLoader?: Handler) {
  let loads = 0;
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: '/items/$id',
    loader: () => {
      loads++;
      return { loaded: loads };
    },
    staticData: {
      modernRouteAction: action,
      modernRouteLoader: modernLoader,
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/items/42?old=1'] }),
  });
  await router.load();
  return { router, loads: () => loads };
}

describe('current framework actions with an actual TanStack router', () => {
  test('GET fetcher calls the native route loader and retains the current location without invalidation', async () => {
    let actionCalls = 0;
    const seen: unknown[] = [];
    const fixture = await nativeRouter(
      () => {
        actionCalls++;
      },
      ({ request, params }) => {
        seen.push({ url: request.url, method: request.method, params });
        return Response.json({ read: true });
      },
    );
    const result = await submitRouteAction({
      router: fixture.router,
      target: { query: 'two words' },
      options: { action: '/items/42', method: 'get' },
      isFetcher: true,
    });
    expect(result).toEqual({ read: true });
    expect(seen).toEqual([
      {
        url: `${window.location.origin}/items/42?query=two+words`,
        method: 'GET',
        params: { id: '42' },
      },
    ]);
    expect(actionCalls).toBe(0);
    expect(fixture.loads()).toBe(1);
    expect(fixture.router.state.location.href).toBe('/items/42?old=1');
  });

  test('GET Form navigation replaces the old search and preserves native loader reuse', async () => {
    const fixture = await nativeRouter(() => null);
    await submitRouteAction({
      router: fixture.router,
      target: { query: 'new' },
      options: { action: '/items/42', method: 'get' },
    });
    expect(fixture.router.state.location.href).toBe('/items/42?query=new');
    expect(fixture.loads()).toBe(1);
  });

  test.each([
    { encType: 'application/json', body: '{"quantity":"2"}' },
    { encType: 'text/plain', body: 'quantity=2' },
    { encType: 'application/x-www-form-urlencoded', body: 'quantity=2' },
  ])('POST $encType preserves action params and waits for native invalidation', async ({
    encType,
    body,
  }) => {
    const seen: unknown[] = [];
    const fixture = await nativeRouter(async ({ request, params }) => {
      seen.push({ method: request.method, params, body: await request.text() });
      return Response.json({ saved: true });
    });
    const phases: string[] = [];
    const result = await submitRouteAction({
      router: fixture.router,
      target: { quantity: 2 },
      options: { action: '/items/42', method: 'post', encType },
      onInvalidateStart: () => phases.push('invalidate'),
    });
    expect(result).toEqual({ saved: true });
    expect(seen).toEqual([{ method: 'POST', params: { id: '42' }, body }]);
    expect(phases).toEqual(['invalidate']);
    expect(fixture.loads()).toBe(2);
  });

  test('a returned 422 Form result is parsed and invalidates', async () => {
    const fixture = await nativeRouter(() =>
      Response.json({ message: 'invalid' }, { status: 422 }),
    );
    const result = await submitRouteAction({
      router: fixture.router,
      target: {},
      options: { action: '/items/42' },
    });
    expect(result).toEqual({ message: 'invalid' });
    expect(fixture.loads()).toBe(2);
  });

  test('a returned 422 fetcher result throws its parsed response and does not invalidate', async () => {
    const fixture = await nativeRouter(() =>
      Response.json({ message: 'invalid' }, { status: 422 }),
    );
    const result = await submitRouteAction({
      router: fixture.router,
      target: {},
      options: { action: '/items/42' },
      isFetcher: true,
    }).then(
      () => undefined,
      error => error,
    );
    expect(result).toBeInstanceOf(RouteActionResponseError);
    expect(result.response.status).toBe(422);
    expect(result.data).toEqual({ message: 'invalid' });
    expect(fixture.loads()).toBe(1);
  });

  test('a thrown server-action Response stays raw for Form and fetcher and does not invalidate', async () => {
    for (const isFetcher of [false, true]) {
      const response = Response.json(
        { message: 'server rejected' },
        { status: 422 },
      );
      const fixture = await nativeRouter(() => {
        throw response;
      });
      const result = await submitRouteAction({
        router: fixture.router,
        target: {},
        options: { action: '/items/42' },
        isFetcher,
      }).then(
        () => undefined,
        error => error,
      );
      expect(result).toBe(response);
      expect(fixture.loads()).toBe(1);
    }
  });
});
