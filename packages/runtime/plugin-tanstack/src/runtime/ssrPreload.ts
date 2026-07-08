// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off

import type {
  RouterMatchWithError,
  TanstackRouterWithServerSsr,
} from './ssrTypes';

type PreloadableRouteComponent = {
  load?: (props?: Record<string, unknown>) => Promise<unknown> | unknown;
  preload?: (props?: Record<string, unknown>) => Promise<unknown> | unknown;
};

type ReactLazyRouteComponent = {
  _init?: (payload: unknown) => unknown;
  _payload?: unknown;
};

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(
    value && typeof (value as PromiseLike<unknown>).then === 'function',
  );
}

function isPreloadableRouteComponent(
  component: unknown,
): component is PreloadableRouteComponent {
  if (!component || typeof component !== 'function') {
    return false;
  }

  const preloadable = component as PreloadableRouteComponent;
  return (
    typeof preloadable.load === 'function' ||
    typeof preloadable.preload === 'function'
  );
}

function isReactLazyRouteComponent(
  component: unknown,
): component is ReactLazyRouteComponent {
  return (
    component !== null &&
    component !== undefined &&
    typeof component === 'object' &&
    typeof (component as ReactLazyRouteComponent)._init === 'function' &&
    '_payload' in component
  );
}

async function preloadReactLazyRouteComponent(
  component: ReactLazyRouteComponent,
) {
  try {
    component._init?.(component._payload);
  } catch (thrown) {
    if (!isPromiseLike(thrown)) {
      throw thrown;
    }
    await thrown;
    component._init?.(component._payload);
  }
}

async function preloadRouteComponent(
  component: unknown,
  preloadedComponents: Set<unknown>,
) {
  if (isReactLazyRouteComponent(component)) {
    if (preloadedComponents.has(component)) {
      return;
    }
    preloadedComponents.add(component);
    await preloadReactLazyRouteComponent(component);
    return;
  }

  if (!isPreloadableRouteComponent(component)) {
    return;
  }

  if (preloadedComponents.has(component)) {
    return;
  }
  preloadedComponents.add(component);

  if (typeof component.load === 'function') {
    await component.load({});
    return;
  }

  await component.preload?.({});
}

export async function preloadMatchedRouteComponents(
  tanstackRouter: TanstackRouterWithServerSsr,
) {
  const matches = Array.isArray(tanstackRouter.state.matches)
    ? (tanstackRouter.state.matches as RouterMatchWithError[])
    : [];
  const routesById = tanstackRouter.routesById || {};
  const preloadedComponents = new Set<unknown>();

  await Promise.all(
    matches.map(async match => {
      const routeId =
        typeof match.routeId === 'string'
          ? match.routeId
          : typeof match.route?.id === 'string'
            ? match.route.id
            : undefined;
      const route = routeId ? routesById[routeId] : match.route;
      const options = route?.options;
      if (!options) {
        return;
      }

      await Promise.all([
        preloadRouteComponent(options.component, preloadedComponents),
        preloadRouteComponent(options.pendingComponent, preloadedComponents),
        preloadRouteComponent(options.errorComponent, preloadedComponents),
        preloadRouteComponent(options.notFoundComponent, preloadedComponents),
      ]);
    }),
  );
}
