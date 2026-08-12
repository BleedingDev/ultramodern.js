// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off

import type { RouteObject } from '@modern-js/runtime-utils/router';
import { createElement, type ElementType } from 'react';

import type { ModernRouteObject } from './types';

type ModernRouteModule = {
  Component?: unknown;
  default?: unknown;
};
type PreloadableComponent = {
  (props: Record<string, unknown>): ReturnType<typeof createElement>;
  load?: () => Promise<unknown>;
  preload?: () => Promise<unknown>;
};

export function pickRouteModuleComponent(
  routeModule: unknown,
  seen: Set<unknown> = new Set(),
): ElementType<Record<string, unknown>> | undefined {
  if (
    typeof routeModule === 'function' ||
    (routeModule &&
      typeof routeModule === 'object' &&
      '$$typeof' in routeModule)
  ) {
    return routeModule as ElementType<Record<string, unknown>>;
  }

  if (!routeModule || typeof routeModule !== 'object') {
    return undefined;
  }
  if (seen.has(routeModule)) {
    return undefined;
  }
  seen.add(routeModule);

  const module = routeModule as ModernRouteModule;
  for (const candidate of [module.default, module.Component]) {
    const component = pickRouteModuleComponent(candidate, seen);
    if (component) {
      return component;
    }
  }

  return undefined;
}

function createServerLazyImportComponent(
  lazyImport: () => unknown,
  fallbackComponent?: unknown,
): PreloadableComponent | unknown {
  if (typeof document !== 'undefined') {
    return fallbackComponent;
  }

  let resolvedComponent: ElementType<Record<string, unknown>> | undefined;
  let pendingLoad: Promise<unknown> | undefined;

  const load = async () => {
    if (resolvedComponent) {
      return resolvedComponent;
    }

    const routeModule = await lazyImport();
    const component = pickRouteModuleComponent(routeModule);
    if (component) {
      resolvedComponent = component;
    }
    return resolvedComponent;
  };

  const Component: PreloadableComponent = props => {
    if (resolvedComponent) {
      return createElement(resolvedComponent, props);
    }

    pendingLoad ||= load();
    throw pendingLoad;
  };
  Component.load = load;
  Component.preload = load;

  return Component;
}

export function toRouteComponent(routeObject: RouteObject): unknown {
  const route = routeObject as ModernRouteObject;
  const lazyImport =
    typeof route.lazyImport === 'function' ? route.lazyImport : undefined;
  const routeComponent = route.Component || route.component;
  const fallbackComponent = routeComponent
    ? routeComponent
    : route.element
      ? () => route.element
      : undefined;

  if (lazyImport && fallbackComponent) {
    return createServerLazyImportComponent(lazyImport, fallbackComponent);
  }

  if (routeComponent) {
    return routeComponent;
  }
  const element = route.element;
  if (element) {
    return () => element;
  }
  return undefined;
}

export function toErrorComponent(routeObject: RouteObject): unknown {
  const route = routeObject as ModernRouteObject;
  if (route.ErrorBoundary) {
    return route.ErrorBoundary;
  }
  if (route.errorElement) {
    return () => route.errorElement;
  }
  return undefined;
}

export function toPendingComponent(routeObject: RouteObject): unknown {
  const route = routeObject as ModernRouteObject;
  return route.HydrateFallback || route.pendingComponent || undefined;
}
