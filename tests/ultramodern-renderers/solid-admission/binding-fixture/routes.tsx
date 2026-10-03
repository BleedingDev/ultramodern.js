import type { FileSystemRouteIR } from '@modern-js/renderer-core/data';
import type { RequestSession } from '@modern-js/renderer-core/session';
import {
  ClientOnly,
  createApplicationRouter,
  createFileSystemRouteTree,
  createMemoryHistory,
  Outlet,
  useHydrated,
  useLoaderData,
  useRouteContext,
} from '@modern-js/renderer-solid/router';
import { HydrationScript } from '@solidjs/web';

export function createProbeRouter(
  side: 'server' | 'client',
  data?: unknown,
  session?: RequestSession,
) {
  const counters = { loader: 0, beforeLoad: 0, routeContext: 0 };
  const privateRequest = new Request('https://example.test/private', {
    headers: { authorization: 'PRIVATE_REQUEST_TOKEN' },
  });
  const rootModule = {
    context() {
      counters.routeContext++;
      return { routeOwner: `route-context-on-${side}` };
    },
    beforeLoad() {
      counters.beforeLoad++;
      return {
        ownerMarker: `before-load-on-${side}`,
        tenant: { name: 'public-tenant' },
      };
    },
    component() {
      return (
        <>
          <Outlet />
          <HydrationScript />
        </>
      );
    },
  };
  const leafModule = {
    component() {
      const value = useLoaderData({ strict: false });
      const hydrated = useHydrated();
      const context = useRouteContext({ strict: false });
      return (
        <>
          <p id="loader-value">{(value() as { text: string }).text}</p>
          <p id="route-context">{context().ownerMarker}</p>
          <p id="hydration-state">{hydrated() ? 'settled' : 'unhydrated'}</p>
          <ClientOnly fallback={<span id="fallback">server-fallback</span>}>
            <span id="client-only">client-visible</span>
          </ClientOnly>
        </>
      );
    },
  };
  const routes: FileSystemRouteIR[] = [
    {
      id: 'layout',
      isRoot: true,
      children: [
        {
          id: 'index',
          index: true,
          modules: { data: '/index.data.ts' },
          children: [],
        },
      ],
    },
  ];
  const routeTree = createFileSystemRouteTree(
    routes,
    { layout: rootModule, index: leafModule },
    {
      request: session?.request ?? privateRequest,
      session,
      context: {
        authenticatedRequest: privateRequest,
        token: 'PRIVATE_REQUEST_TOKEN',
      },
      loadRoute: async () => {
        counters.loader++;
        return {
          kind: 'success',
          value: data ?? { text: `loaded-on-${side}` },
          response: {
            status: 200,
            statusText: 'OK',
            headers: [],
            cachePolicy: 'public',
          },
        };
      },
    },
  );
  const router = createApplicationRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { optionsOwner: `options-context-on-${side}` },
  });
  return { router, counters };
}
