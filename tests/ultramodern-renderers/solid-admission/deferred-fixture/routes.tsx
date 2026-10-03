import type {
  DataOutcome,
  FileSystemRouteIR,
} from '@modern-js/renderer-core/data';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import type { RequestSession } from '@modern-js/renderer-core/session';
import {
  createApplicationRouter,
  createFileSystemRouteTree,
  createMemoryHistory,
  Outlet,
  useLoaderData,
} from '@modern-js/renderer-solid/router';
import { createMemo, Errored, Loading, onCleanup } from 'solid-js';

export const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'managed-deferred-hydration',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'packed-native-deferred',
};

function deferredErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  )
    return error.message;
  return String(error);
}

export function createDeferredRouter(
  side: 'server' | 'client',
  deferred: Promise<unknown>,
  session?: RequestSession,
) {
  const counters = { loader: 0, cleanup: 0 };
  function DeferredValue() {
    const data = useLoaderData({ strict: false });
    const value = createMemo(async () => {
      const record: unknown = data();
      if (!record || typeof record !== 'object' || !('later' in record))
        throw new Error('Expected a managed deferred loader record');
      const result: unknown = await record.later;
      if (!result || typeof result !== 'object' || !('text' in result))
        throw new Error('Expected a public deferred result');
      if (typeof result.text !== 'string')
        throw new Error('Expected public deferred text');
      return result.text;
    });
    onCleanup(() => counters.cleanup++);
    return (
      <Loading fallback={<p id="deferred-pending">Native deferred pending</p>}>
        <p id="deferred-value">{value()}</p>
      </Loading>
    );
  }
  const routes: FileSystemRouteIR[] = [
    {
      id: 'layout',
      isRoot: true,
      children: [
        {
          id: 'item',
          path: 'item',
          modules: { data: '/item.data.ts' },
          children: [],
        },
      ],
    },
  ];
  const routeTree = createFileSystemRouteTree(
    routes,
    {
      layout: { component: () => <Outlet /> },
      item: {
        component: () => (
          <Errored
            fallback={(error, reset) => (
              <section id="deferred-error">
                <p>Native deferred error: {deferredErrorMessage(error())}</p>
                <button type="button" onClick={reset}>
                  Reset native boundary
                </button>
              </section>
            )}
          >
            <DeferredValue />
          </Errored>
        ),
      },
    },
    {
      request: session?.request,
      session,
      context: session?.platform.bindings,
      loadRoute: async (): Promise<DataOutcome> => {
        counters.loader++;
        return {
          kind: 'deferred',
          critical: { ready: 'public-critical' },
          deferred: {
            later:
              side === 'server'
                ? deferred
                : Promise.resolve({ text: 'native-client-retry-success' }),
          },
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
    history: createMemoryHistory({ initialEntries: ['/item'] }),
    origin: 'https://deferred.test',
    isServer: side === 'server',
    context: { ultramodern: { rendererIdentity: identity } },
  });
  return { router, counters };
}
