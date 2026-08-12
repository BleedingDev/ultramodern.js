// @effect-diagnostics strictBooleanExpressions:off
import type { RouteObject } from '@modern-js/runtime-utils/router';
import React from 'react';
import { mergeModernRouteHandle } from './routeTree/staticData';
import type { ModernRoute } from './types';

type RouterConfig = {
  routesConfig: {
    globalApp?: React.ComponentType<any>;
    routes?: ModernRoute[];
  };
};

type LayoutWrapperProps = {
  [key: string]: unknown;
};

type GlobalAppProps = {
  Component: React.ComponentType;
  [key: string]: unknown;
};

type ModernRouteObject = RouteObject & {
  Component?: React.ComponentType | string;
  action?: unknown;
  clientData?: unknown;
  config?: { handle?: Record<string, unknown> } | unknown;
  handle?: Record<string, unknown>;
  hasAction?: boolean;
  hasClientLoader?: boolean;
  hasLoader?: boolean;
  inValidSSRRoute?: boolean;
  isClientComponent?: boolean;
  lazyImport?: () => Promise<{ default: React.ComponentType }>;
};

function withGlobalLayout(
  Component: React.ComponentType,
  globalApp?: React.ComponentType<GlobalAppProps>,
): React.ComponentType {
  if (!globalApp) {
    return Component;
  }

  const GlobalLayout = globalApp;
  return function LayoutWrapper(props: LayoutWrapperProps) {
    return <GlobalLayout Component={Component} {...props} />;
  };
}

function toTanstackRouteObject(
  route: ModernRoute,
  globalApp?: React.ComponentType<GlobalAppProps>,
): RouteObject | null {
  if (route.type === 'nested') {
    return {
      path: route.path,
      id: route.id,
      loader: route.loader,
      action: route.action,
      shouldRevalidate: route.shouldRevalidate,
      handle: mergeModernRouteHandle(route) ?? {},
      index: route.index,
      hasLoader: route.hasLoader || Boolean(route.loader),
      hasClientLoader: route.hasClientLoader || Boolean(route.clientData),
      hasAction: route.hasAction || Boolean(route.action),
      ...(route.isClientComponent ? { isClientComponent: true } : {}),
      ...(route.inValidSSRRoute ? { inValidSSRRoute: true } : {}),
      lazyImport: route.lazyImport,
      Component: route.component ? route.component : undefined,
      errorElement: route.error
        ? React.createElement(route.error as React.ComponentType)
        : undefined,
      children: route.children
        ? route.children
            .map(child => toTanstackRouteObject(child, globalApp))
            .filter((child): child is RouteObject => child !== null)
        : undefined,
    } as ModernRouteObject;
  }

  if (
    typeof route.component !== 'function' &&
    typeof route.component !== 'object'
  ) {
    return null;
  }

  const LayoutComponent = withGlobalLayout(
    route.component as React.ComponentType,
    globalApp,
  );
  return {
    path: route.path,
    element: React.createElement(LayoutComponent),
  };
}

export function createTanstackRouteObjectsFromConfig({
  routesConfig,
}: {
  routesConfig: RouterConfig['routesConfig'];
}): RouteObject[] | null {
  if (!routesConfig) {
    return null;
  }
  const { routes, globalApp } = routesConfig;
  if (!routes) {
    return null;
  }
  return routes
    .map(route => toTanstackRouteObject(route, globalApp))
    .filter((route): route is RouteObject => route !== null);
}
