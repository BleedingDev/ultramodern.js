import type {
  DataOutcome,
  FileSystemRouteIR,
} from '@modern-js/renderer-core/data';
import { hydrate as hydrateRouter } from '@tanstack/router-core/ssr/client';
import { attachRouterServerSsrUtils } from '@tanstack/router-core/ssr/server';
import { flush } from 'solid-js';
import { mountApplication } from '../../src/client';
import {
  ApplicationRouter,
  createApplicationRouter,
  createFileSystemRouteTree,
  createMemoryHistory,
  type FileSystemRouteOptions,
  Outlet,
  useLoaderData,
} from '../../src/router';

const routes: FileSystemRouteIR[] = [
  {
    id: 'root',
    isRoot: true,
    children: [
      {
        id: 'section',
        children: [
          {
            id: 'item',
            path: 'items/:itemId',
            modules: { data: '/item.data.ts' },
            children: [],
          },
        ],
      },
    ],
  },
];
const expectedChain = ['__root__', '/section', '/section/items/$itemId'];
const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  flush();
});

function success(critical: string): DataOutcome {
  return {
    kind: 'success',
    value: { critical },
    response: {
      status: 200,
      statusText: 'OK',
      headers: [],
      cachePolicy: 'no-store',
    },
  };
}

function fixture(
  loadRoute: NonNullable<FileSystemRouteOptions['loadRoute']>,
  isServer = false,
) {
  const router = createApplicationRouter({
    routeTree: createFileSystemRouteTree(
      routes,
      {
        root: { component: Outlet },
        section: { component: Outlet },
        item: {
          component: () => {
            const data = useLoaderData({
              strict: false,
              select: value => {
                if (
                  value === null ||
                  typeof value !== 'object' ||
                  !('critical' in value)
                ) {
                  throw new Error('The native route has no critical data');
                }
                return String(value.critical);
              },
            });
            return <p>{data()}</p>;
          },
        },
      },
      {
        request: new Request('http://localhost/items/42'),
        loadRoute,
      },
    ),
    history: createMemoryHistory({ initialEntries: ['/items/42'] }),
    origin: 'http://localhost',
    defaultStaleTime: Number.POSITIVE_INFINITY,
    defaultPreloadStaleTime: Number.POSITIVE_INFINITY,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    isServer,
  });
  const element = document.createElement('div');
  return {
    router,
    element,
    mount() {
      disposers.push(
        mountApplication(() => <ApplicationRouter router={router} />, element),
      );
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    flush();
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('The native router lifecycle did not settle');
}

describe('native Solid router lifecycle', () => {
  test('explicit route preload is reused by native navigation without another data invocation', async () => {
    const calls: string[] = [];
    const app = fixture(async (_route, input) => {
      calls.push(input.params.itemId);
      return success(input.params.itemId);
    });
    await app.router.load();
    app.mount();
    await waitFor(() => app.element.textContent === '42');
    expect(calls).toEqual(['42']);

    const preloaded = await app.router.preloadRoute({ to: '/items/84' });
    expect(preloaded?.map(match => match.routeId)).toEqual(expectedChain);
    expect(calls).toEqual(['42', '84']);
    expect(app.router.state.location.pathname).toBe('/items/42');
    expect(app.element.textContent).toBe('42');

    await app.router.navigate({ to: '/items/84' });
    await waitFor(() => app.element.textContent === '84');
    expect(app.router.state.location.pathname).toBe('/items/84');
    expect(calls).toEqual(['42', '84']);
    expect(app.router.state.matches.at(-1)?.loaderData).toEqual({
      critical: '84',
    });
  });

  test('the winning pending native navigation stays committed when the superseded producer finishes later', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const requests: { itemId: string; signal: AbortSignal }[] = [];
    const completed: string[] = [];
    const app = fixture(async (_route, input) => {
      const itemId = input.params.itemId;
      requests.push({ itemId, signal: input.request.signal });
      if (itemId === '42') return success('initial');
      const value = await (itemId === 'first' ? first.promise : second.promise);
      completed.push(itemId);
      return success(value);
    });
    await app.router.load();
    app.mount();
    await waitFor(() => app.element.textContent === 'initial');

    const firstNavigation = app.router.navigate({ to: '/items/first' });
    const firstCompletion = Promise.allSettled([firstNavigation]);
    await waitFor(() => requests.length === 2);
    expect(app.router.state.isLoading).toBe(true);
    const secondNavigation = app.router.navigate({ to: '/items/second' });
    await waitFor(() => requests.length === 3);
    expect(app.router.state.isLoading).toBe(true);
    await waitFor(() => requests[1]?.signal.aborted === true);

    second.resolve('winner');
    await secondNavigation;
    await waitFor(() => app.element.textContent === 'winner');
    const winner = app.element.firstElementChild;
    expect(app.router.state.location.pathname).toBe('/items/second');

    first.resolve('late-loser');
    expect((await firstCompletion)[0]?.status).toBe('fulfilled');
    await waitFor(() => completed.length === 2);
    expect(completed).toEqual(['second', 'first']);
    expect(requests.map(request => request.itemId)).toEqual([
      '42',
      'first',
      'second',
    ]);
    expect(app.router.state.location.pathname).toBe('/items/second');
    expect(app.router.state.matches.at(-1)?.loaderData).toEqual({
      critical: 'winner',
    });
    expect(app.element.textContent).toBe('winner');
    expect(app.element.firstElementChild).toBe(winner);
  });

  test('native SSR serialization and router hydration preserve the ordered route chain through navigation', async () => {
    const serverCalls: string[] = [];
    const server = fixture(async (_route, input) => {
      serverCalls.push(input.params.itemId);
      return success(`server-${input.params.itemId}`);
    }, true);
    const previousBootstrap = window.$_TSR;
    Reflect.deleteProperty(window, '$_TSR');
    attachRouterServerSsrUtils({ router: server.router, manifest: undefined });
    const nativeSsr = server.router.serverSsr!;
    try {
      await server.router.load();
      const serverChain = server.router.state.matches.map(
        match => match.routeId,
      );
      expect(serverChain).toEqual(expectedChain);
      expect(
        server.router.state.matches.every(match => match.ssr === true),
      ).toBe(true);
      expect(serverCalls).toEqual(['42']);
      await nativeSsr.dehydrate();
      const tags = nativeSsr.takeInitialHydrationScriptTags();
      if (!tags) {
        throw new Error('The native SSR serializer emitted no bootstrap');
      }
      // Execute the actual native serializer's script records; native hydrate
      // decodes and commits them rather than receiving fabricated match DTOs.
      for (const tag of tags.before) {
        if (tag.tag === 'script' && tag.children) {
          const script = document.createElement('script');
          new Function(
            'scope',
            'scriptDocument',
            `with(scope) { (function(document) { ${tag.children} })(scriptDocument) }`,
          )(window, { currentScript: script });
        }
      }
      const clientCalls: string[] = [];
      const client = fixture(async (_route, input) => {
        clientCalls.push(input.params.itemId);
        return success(`client-${input.params.itemId}`);
      });
      await hydrateRouter(client.router);
      window.$_TSR?.h();
      expect(client.router.state.matches.map(match => match.routeId)).toEqual(
        serverChain,
      );
      expect(client.router.state.matches.at(-1)?.params.itemId).toBe('42');
      expect(clientCalls).toEqual([]);
      client.mount();
      await waitFor(() => client.element.textContent === 'server-42');
      expect(clientCalls).toEqual([]);

      await client.router.navigate({ to: '/items/84' });
      await waitFor(() => client.element.textContent === 'client-84');
      expect(client.router.state.matches.map(match => match.routeId)).toEqual(
        serverChain,
      );
      expect(client.router.state.matches.at(-1)?.params.itemId).toBe('84');
      expect(clientCalls).toEqual(['84']);
      expect(serverCalls).toEqual(['42']);
    } finally {
      nativeSsr.cleanup();
      Reflect.deleteProperty(window, '$_TSR');
      if (previousBootstrap) window.$_TSR = previousBootstrap;
    }
  });
});
