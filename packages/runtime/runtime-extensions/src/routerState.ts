// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off
import { createRuntimeContextExtension } from './contextExtensions';
import type {
  InternalRouterRuntimeState,
  InternalRouterServerSnapshot,
  RouterServerPrepareResult,
} from './routerStateTypes';

export type {
  BuiltInRouterFramework,
  InternalRouterRuntimeState,
  InternalRouterServerSnapshot,
  RouterFramework,
  RouterLifecyclePhase,
  RouterLinkTarget,
  RouterNavigationCapability,
  RouterNavigationSnapshot,
  RouterRouteMatchSnapshot,
  RouterServerPrepareResult,
} from './routerStateTypes';

/**
 * Router runtime state is shared by every router provider (react-router,
 * @modern-js/plugin-tanstack, ...) and consumed by the SSR pipeline. It lives
 * in the runtime-context extension slot instead of ad-hoc fields on
 * `TInternalRuntimeContext`.
 */
const routerRuntimeStateExtension =
  createRuntimeContextExtension<InternalRouterRuntimeState>(
    '@modern-js/runtime:router-runtime-state',
  );

/**
 * The server snapshot is tracked separately: a later
 * `applyRouterRuntimeState` call without a snapshot must not clear a
 * previously captured one.
 */
const routerServerSnapshotExtension =
  createRuntimeContextExtension<InternalRouterServerSnapshot>(
    '@modern-js/runtime:router-server-snapshot',
  );

export function getRouterRuntimeState(
  runtimeContext: object,
): InternalRouterRuntimeState | undefined {
  return routerRuntimeStateExtension.get(runtimeContext);
}

export function getRouterServerSnapshot(
  runtimeContext: object,
): InternalRouterServerSnapshot | undefined {
  return routerServerSnapshotExtension.get(runtimeContext);
}

/** Capture prepared metadata once; live router updates cannot rewrite it. */
export function createRouterServerSnapshot(
  snapshot: InternalRouterServerSnapshot,
): InternalRouterServerSnapshot {
  const matches = snapshot.matches?.map(match =>
    Object.freeze({
      ...match,
      ...(match.params ? { params: Object.freeze({ ...match.params }) } : {}),
    }),
  );
  const matchedRouteIds =
    snapshot.matchedRouteIds ??
    matches?.map(match => match.assetRouteId ?? match.routeId);
  return Object.freeze({
    ...snapshot,
    ...(snapshot.hydrationScripts
      ? { hydrationScripts: Object.freeze([...snapshot.hydrationScripts]) }
      : {}),
    ...(matchedRouteIds
      ? { matchedRouteIds: Object.freeze([...matchedRouteIds]) }
      : {}),
    ...(matches ? { matches: Object.freeze(matches) } : {}),
    ...(snapshot.errors
      ? { errors: Object.freeze({ ...snapshot.errors }) }
      : {}),
    ...(snapshot.routerData
      ? {
          routerData: Object.freeze({
            ...snapshot.routerData,
            ...(snapshot.routerData.loaderData
              ? {
                  loaderData: Object.freeze({
                    ...snapshot.routerData.loaderData,
                  }),
                }
              : {}),
            ...(snapshot.routerData.errors
              ? { errors: Object.freeze({ ...snapshot.routerData.errors }) }
              : {}),
          }),
        }
      : {}),
  });
}

/**
 * Listeners per runtime context, so a consumer can react to the slot being
 * filled in. A router provider publishes its instance during render - TanStack
 * installs it when `RouterWrapper` renders - which is after anything that
 * wraps the app has already evaluated. Without a notification those wrappers
 * would hold a routerless view of the app for the rest of the session.
 *
 * Keyed weakly: the runtime context outlives neither the app nor this map.
 */
const routerRuntimeStateListeners = new WeakMap<object, Set<() => void>>();

/**
 * Observe the router runtime-state slot for the given runtime context.
 * Returns an unsubscribe function; safe to call for a context that never
 * receives a router.
 */
export function subscribeRouterRuntimeState(
  runtimeContext: object,
  listener: () => void,
): () => void {
  if (!runtimeContext || typeof runtimeContext !== 'object') {
    return () => undefined;
  }
  let listeners = routerRuntimeStateListeners.get(runtimeContext);
  if (!listeners) {
    listeners = new Set();
    routerRuntimeStateListeners.set(runtimeContext, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
  };
}

/** Contexts with a notification already scheduled, so a burst coalesces. */
const pendingRouterRuntimeStateNotifications = new WeakSet<object>();

function notifyRouterRuntimeState(runtimeContext: object) {
  const listeners = routerRuntimeStateListeners.get(runtimeContext);
  if (!listeners?.size) {
    return;
  }
  if (pendingRouterRuntimeStateNotifications.has(runtimeContext)) {
    return;
  }
  pendingRouterRuntimeStateNotifications.add(runtimeContext);
  // Deferred deliberately. A router provider publishes its instance from
  // inside its own render - `RouterWrapper` does - so calling observers
  // synchronously would schedule an update on a component that is rendering,
  // which React reports as "Cannot update a component while rendering a
  // different component". Delivering after the current render lands keeps the
  // notification correct and silent.
  const deliver = () => {
    pendingRouterRuntimeStateNotifications.delete(runtimeContext);
    const current = routerRuntimeStateListeners.get(runtimeContext);
    if (!current?.size) {
      return;
    }
    for (const listener of [...current]) {
      try {
        listener();
      } catch {
        // One bad observer must not stop the router from being published.
      }
    }
  };
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(deliver);
  } else {
    setTimeout(deliver, 0);
  }
}

export function applyRouterRuntimeState<Context extends object>(
  runtimeContext: Context,
  state: InternalRouterRuntimeState,
) {
  const previous = routerRuntimeStateExtension.get(runtimeContext);
  routerRuntimeStateExtension.set(runtimeContext, state);
  // Only a change of identity is worth a re-render; `RouterWrapper` reapplies
  // the same instance on every render of the app.
  if (
    previous?.instance !== state.instance ||
    previous?.framework !== state.framework ||
    previous?.navigation !== state.navigation
  ) {
    notifyRouterRuntimeState(runtimeContext);
  }

  return runtimeContext;
}

export function applyRouterServerPrepareResult<Context extends object>(
  runtimeContext: Context,
  result: RouterServerPrepareResult,
) {
  if (result.snapshot) {
    routerServerSnapshotExtension.set(
      runtimeContext,
      createRouterServerSnapshot(result.snapshot),
    );
  }
  return applyRouterRuntimeState(runtimeContext, {
    ...result.state,
    cleanup: result.cleanup ?? result.state.cleanup,
  });
}

export function getRouterHydrationScripts(runtimeContext: object) {
  return getRouterServerSnapshot(runtimeContext)?.hydrationScripts ?? [];
}

export function getRouterMatchedRouteIds(runtimeContext: object) {
  return getRouterServerSnapshot(runtimeContext)?.matchedRouteIds;
}

export async function cleanupRouterRuntimeState(runtimeContext: object) {
  try {
    await getRouterRuntimeState(runtimeContext)?.cleanup?.();
  } catch {}
}
