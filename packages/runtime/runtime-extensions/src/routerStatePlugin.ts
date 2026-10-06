import type { createMemoryRouter } from '@modern-js/runtime-utils/router';
import { createRouterPrefetchPolicy } from './routerPrefetchPolicy';
import {
  applyRouterRuntimeState,
  applyRouterServerPrepareResult,
  getRouterRuntimeState,
  getRouterServerSnapshot,
} from './routerState';
import type {
  RouterNavigationCapability,
  RouterNavigationSnapshot,
} from './routerStateTypes';

type ReactRouterServerContext = {
  statusCode: number;
  errors?: Record<string, unknown> | null;
  loaderData: Record<string, unknown>;
  matches: { route: { id?: string } }[];
};

type RouterLifecycleEvent = {
  framework: string;
  phase: string;
  runtimeContext: object;
  basename?: string;
  router?: unknown;
};

type PreparedRequest<RuntimeContext extends object = object> = {
  runtimeContext: RuntimeContext;
  routerResult?: {
    statusCode?: number;
    errors?: Record<string, unknown> | null;
  };
};

export const ROUTER_CLEANUP_ERROR =
  'An error occurs during router runtime cleanup';

// Provider wrappers and application composition may share the same native API.
// Install their common request policy once for that runtime instance.
const installedRouterPolicies = new WeakSet<object>();

function createReactRouterNavigation(
  router: ReturnType<typeof createMemoryRouter>,
  Link: RouterNavigationCapability['Link'],
): RouterNavigationCapability {
  let state: typeof router.state | undefined;
  let snapshot: RouterNavigationSnapshot;
  return {
    Link,
    getSnapshot() {
      if (state !== router.state) {
        state = router.state;
        snapshot = {
          location: state.location,
          params: Object.assign(
            {},
            ...state.matches.map(match => match.params),
          ),
        };
      }
      return snapshot;
    },
    subscribe: listener => router.subscribe(listener),
    navigate: (href, options) => router.navigate(href, options),
  };
}

/** Install fork policy through lifecycle hooks supplied by the native owner. */
export function createRouterStatePlugin<Hooks extends Record<string, unknown>>({
  registryHooks,
}: {
  registryHooks: Hooks;
}) {
  return {
    name: '@modern-js/router-runtime-policy',
    registryHooks,
    setup(api: {
      onBeforeRender: (callback: (context: object) => void) => unknown;
      onRenderPrepared: (
        callback: <RuntimeContext extends object>(
          info: PreparedRequest<RuntimeContext>,
        ) => PreparedRequest<RuntimeContext>,
      ) => unknown;
      onRequestEnd: (
        callback: (info: { runtimeContext: object }) => Promise<void>,
      ) => unknown;
      onAfterCreateRouter: (
        callback: (event: RouterLifecycleEvent) => void,
      ) => unknown;
    }) {
      if (installedRouterPolicies.has(api)) {
        return;
      }
      installedRouterPolicies.add(api);
      api.onBeforeRender(context => {
        const runtimeContext = context as {
          linkPrefetchPolicy?: ReturnType<typeof createRouterPrefetchPolicy>;
        };
        runtimeContext.linkPrefetchPolicy ??= createRouterPrefetchPolicy();
      });
      api.onRenderPrepared(info => {
        const snapshot = getRouterServerSnapshot(info.runtimeContext);
        if (!snapshot) {
          return info;
        }
        return {
          ...info,
          routerResult: {
            statusCode: snapshot.statusCode ?? info.routerResult?.statusCode,
            errors: snapshot.errors ?? info.routerResult?.errors,
          },
        };
      });
      api.onRequestEnd(async ({ runtimeContext }) => {
        try {
          await getRouterRuntimeState(runtimeContext)?.cleanup?.();
        } catch (error) {
          const { ssrContext } = runtimeContext as {
            ssrContext?: {
              onError: (error: unknown, message: string) => void;
            };
          };
          if (!ssrContext) {
            throw error;
          }
          ssrContext.onError(error, ROUTER_CLEANUP_ERROR);
        }
      });
      api.onAfterCreateRouter(event => {
        if (event.framework !== 'react-router') {
          return;
        }
        if (event.phase === 'ssr-prepare') {
          const { routerContext } = event.runtimeContext as {
            routerContext?: ReactRouterServerContext;
          };
          if (!routerContext) {
            return;
          }
          const snapshot = {
            framework: event.framework,
            basename: event.basename,
            statusCode: routerContext.statusCode,
            errors: routerContext.errors ?? undefined,
            routerData: {
              loaderData: routerContext.loaderData,
              errors: routerContext.errors ?? undefined,
            },
            matches: routerContext.matches.flatMap(match =>
              typeof match.route.id === 'string'
                ? [{ routeId: match.route.id }]
                : [],
            ),
          };
          applyRouterServerPrepareResult(event.runtimeContext, {
            snapshot,
            state: {
              framework: event.framework,
              basename: event.basename,
              instance: event.router,
            },
          });
        } else if (event.phase === 'client-create') {
          const router = event.router as ReturnType<typeof createMemoryRouter>;
          const { router: api } = event.runtimeContext as {
            router?: { Link?: RouterNavigationCapability['Link'] };
          };
          applyRouterRuntimeState(event.runtimeContext, {
            framework: event.framework,
            basename: event.basename,
            instance: router,
            ...(api?.Link
              ? { navigation: createReactRouterNavigation(router, api.Link) }
              : {}),
          });
        }
      });
    },
  };
}
