// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off

import { DefaultNotFound } from '@modern-js/runtime/context';
import type { RouteObject } from '@modern-js/runtime-utils/router';
import type { AnyRoute, AnyRouter } from '@tanstack/react-router';
import { rootRouteId } from '@tanstack/react-router';

import { createRouteStaticData } from '../../shared/routeStaticData';
import { withModernRouteMatchContext } from '../outlet';
import {
  toErrorComponent,
  toPendingComponent,
  toRouteComponent,
} from './components';
import { createModernShouldReload, wrapRouteObjectLoader } from './loaders';
import { isRouteObjectPathlessLayout, toTanstackPath } from './paths';
import { mergeModernRouteHandle } from './staticData';
import {
  createTanstackRootRoute,
  createTanstackRoute,
  wrapRouteComponentWithModernContext,
} from './tanstackRoutes';
import type {
  ModernRouteObject,
  ModernTanstackRootRoute,
  MutableTanstackRoute,
  RouteRevalidationState,
  RouteTreeOptions,
  TanstackRootRouteOptions,
  TanstackRouteOptions,
} from './types';

function createRouteFromRouteObject(opts: {
  options?: RouteTreeOptions;
  parent: AnyRoute;
  pathlessFallbackId?: string;
  routeObject: RouteObject;
}): AnyRoute {
  const {
    options = {},
    parent,
    pathlessFallbackId = 'pathless',
    routeObject,
  } = opts;
  const modernRouteObject = routeObject as ModernRouteObject;
  const revalidationState: RouteRevalidationState = {};
  const shouldRevalidate = modernRouteObject.shouldRevalidate;
  const shouldReload = createModernShouldReload(
    shouldRevalidate,
    revalidationState,
  );

  const stableFallbackId =
    routeObject.id || modernRouteObject.file || pathlessFallbackId;

  const component = toRouteComponent(routeObject);
  const base: TanstackRouteOptions = {
    getParentRoute: () => parent,
    component,
    pendingComponent: toPendingComponent(routeObject),
    errorComponent: toErrorComponent(routeObject),
    validateSearch: modernRouteObject.validateSearch,
    loaderDeps: modernRouteObject.loaderDeps,
    staticData: createRouteStaticData({
      modernRouteId: routeObject.id,
      modernRouteAction: modernRouteObject.action,
      modernRouteHandle: mergeModernRouteHandle(modernRouteObject),
      modernRouteHasAction:
        modernRouteObject.hasAction || Boolean(modernRouteObject.action),
      modernRouteHasClientLoader:
        modernRouteObject.hasClientLoader ||
        typeof modernRouteObject.clientData !== 'undefined',
      modernRouteHasLoader:
        modernRouteObject.hasLoader ||
        typeof modernRouteObject.loader === 'function',
      modernRouteIsClientComponent: modernRouteObject.isClientComponent,
      modernRouteLoader: modernRouteObject.loader,
      modernRouteShouldRevalidate: shouldRevalidate,
    }),
    loader: wrapRouteObjectLoader(routeObject, revalidationState, options),
  };
  if (modernRouteObject.inValidSSRRoute) {
    base.ssr = false;
  }
  if (shouldReload) {
    base.shouldReload = shouldReload;
  }

  if (isRouteObjectPathlessLayout(routeObject)) {
    base.id = stableFallbackId;
  } else {
    base.path = routeObject.index
      ? '/'
      : toTanstackPath((routeObject.path as string) || '');
  }

  const route = createTanstackRoute(base);
  wrapRouteComponentWithModernContext(route, component, routeObject.id);

  const children = routeObject.children;
  if (children && children.length > 0) {
    const childRoutes = children.map((child: RouteObject, index) =>
      createRouteFromRouteObject({
        options,
        parent: route,
        pathlessFallbackId: `pathless-${index}`,
        routeObject: child,
      }),
    );
    route.addChildren(childRoutes);
  }

  return route;
}

function getRootLikeRouteObject(routes: RouteObject[]) {
  return routes.find(route => route.path === '/' && !route.index);
}

export function createRouteTreeFromRouteObjects(
  routes: RouteObject[],
  options: RouteTreeOptions = {},
): ModernTanstackRootRoute {
  const rootLikeRoute = getRootLikeRouteObject(routes) as
    | ModernRouteObject
    | undefined;
  const rootRevalidationState: RouteRevalidationState = {};
  const rootShouldRevalidate = rootLikeRoute?.shouldRevalidate;
  const rootShouldReload = createModernShouldReload(
    rootShouldRevalidate,
    rootRevalidationState,
  );

  const rootComponent = rootLikeRoute
    ? toRouteComponent(rootLikeRoute)
    : undefined;
  const rootRouteOptions: TanstackRootRouteOptions = {
    component: rootComponent,
    pendingComponent: rootLikeRoute
      ? toPendingComponent(rootLikeRoute)
      : undefined,
    errorComponent: rootLikeRoute ? toErrorComponent(rootLikeRoute) : undefined,
    validateSearch: rootLikeRoute?.validateSearch,
    loaderDeps: rootLikeRoute?.loaderDeps,
    notFoundComponent: DefaultNotFound,
    staticData: createRouteStaticData({
      modernRouteId: rootLikeRoute?.id,
      modernRouteAction: rootLikeRoute?.action,
      modernRouteHandle: rootLikeRoute
        ? mergeModernRouteHandle(rootLikeRoute)
        : undefined,
      modernRouteHasAction:
        rootLikeRoute?.hasAction || Boolean(rootLikeRoute?.action),
      modernRouteHasClientLoader:
        rootLikeRoute?.hasClientLoader ||
        typeof rootLikeRoute?.clientData !== 'undefined',
      modernRouteHasLoader:
        rootLikeRoute?.hasLoader || typeof rootLikeRoute?.loader === 'function',
      modernRouteIsClientComponent: rootLikeRoute?.isClientComponent,
      modernRouteLoader: rootLikeRoute?.loader,
      modernRouteShouldRevalidate: rootShouldRevalidate,
    }),
    loader: rootLikeRoute
      ? wrapRouteObjectLoader(rootLikeRoute, rootRevalidationState, options)
      : undefined,
  };
  if (rootShouldReload) {
    rootRouteOptions.shouldReload = rootShouldReload;
  }
  if (rootLikeRoute?.inValidSSRRoute) {
    rootRouteOptions.ssr = false;
  }

  const rootRoute = createTanstackRootRoute(rootRouteOptions);
  if (rootComponent) {
    rootRoute.options.component = withModernRouteMatchContext(
      rootComponent,
      rootRouteId,
    ) as typeof rootRoute.options.component;
  }

  const topLevel = rootLikeRoute
    ? [
        ...((rootLikeRoute.children as RouteObject[] | undefined) || []),
        ...routes.filter(route => route !== rootLikeRoute),
      ]
    : routes;

  const childRoutes = topLevel.map((routeObject, index) =>
    createRouteFromRouteObject({
      options,
      parent: rootRoute,
      pathlessFallbackId: `pathless-${index}`,
      routeObject,
    }),
  );

  rootRoute.addChildren(childRoutes);
  return rootRoute as unknown as ModernTanstackRootRoute;
}

export function getModernRouteIdsFromMatches(router: AnyRouter): string[] {
  const matches = router.state.matches || [];
  const routesById = (
    router as AnyRouter & {
      routesById?: Record<
        string,
        {
          options?: {
            staticData?: { modernRouteId?: unknown };
          };
        }
      >;
    }
  ).routesById;
  const ids = matches
    .map(match => {
      const normalizedMatch = match as {
        route?: {
          options?: {
            staticData?: { modernRouteId?: unknown };
          };
        };
        routeId?: unknown;
      };
      const routeId =
        typeof normalizedMatch.routeId === 'string'
          ? normalizedMatch.routeId
          : undefined;
      return (
        normalizedMatch.route?.options?.staticData?.modernRouteId ??
        (routeId
          ? routesById?.[routeId]?.options?.staticData?.modernRouteId
          : undefined)
      );
    })
    .filter((id): id is string => typeof id === 'string');
  return Array.from(new Set(ids));
}
