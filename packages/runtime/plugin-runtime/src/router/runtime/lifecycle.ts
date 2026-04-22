import type { RouteObject } from '@modern-js/runtime-utils/router';
import type { TInternalRuntimeContext } from '../../core/context/runtime';
import type {
  InternalRouterRuntimeState,
  InternalRouterServerSnapshot,
  RouterFramework,
} from './types';

export type RouterLifecyclePhase =
  | 'ssr-prepare'
  | 'client-create'
  | 'hydrate';

export type RouterLifecycleContext = {
  framework: RouterFramework;
  phase: RouterLifecyclePhase;
  routes: RouteObject[];
  runtimeContext: TInternalRuntimeContext;
  basename?: string;
  hydrationData?: unknown;
  router?: unknown;
  serverSnapshot?: InternalRouterServerSnapshot;
};

export function createRouterRuntimeState(
  state: InternalRouterRuntimeState,
): InternalRouterRuntimeState {
  const serverSnapshot = state.serverSnapshot
    ? {
        ...state.serverSnapshot,
        framework: state.serverSnapshot.framework ?? state.framework,
        basename: state.serverSnapshot.basename ?? state.basename,
      }
    : undefined;

  return {
    ...state,
    ...(serverSnapshot ? { serverSnapshot } : {}),
  };
}

export function applyRouterRuntimeState(
  runtimeContext: TInternalRuntimeContext,
  state: InternalRouterRuntimeState,
) {
  const normalized = createRouterRuntimeState(state);
  runtimeContext.routerFramework = normalized.framework;
  runtimeContext.routerInstance = normalized.instance;
  runtimeContext.routerHydrationScript = normalized.hydrationScript;
  runtimeContext.routerMatchedRouteIds = normalized.matchedRouteIds;
  runtimeContext.routerRuntime = normalized;

  if (normalized.serverSnapshot) {
    runtimeContext.routerServerSnapshot = normalized.serverSnapshot;
  }

  return runtimeContext;
}
