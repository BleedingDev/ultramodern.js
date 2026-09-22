// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off

import { DefaultNotFound } from '@modern-js/runtime/context';
import type { RouteObject } from '@modern-js/runtime-utils/router';
import type { AnyRoute, AnyRouter } from '@tanstack/react-router';
import { rootRouteId } from '@tanstack/react-router';

import {
  describeRouteTree,
  type RouteDescriptor,
} from '../../shared/routeDescriptor';
import { createRouteStaticData } from '../../shared/routeStaticData';
import { withModernRouteMatchContext } from '../outlet';
import {
  toErrorComponent,
  toPendingComponent,
  toRouteComponent,
} from './components';
import { createModernShouldReload, wrapRouteObjectLoader } from './loaders';
import { mergeModernRouteHandle } from './staticData';
import {
  createTanstackRootRoute,
  createTanstackRoute,
  wrapRouteComponentWithModernContext,
} from './tanstackRoutes';
import type {
  ModernRouteObject,
  ModernTanstackRootRoute,
  RouteRevalidationState,
  RouteTreeOptions,
  TanstackRootRouteOptions,
  TanstackRouteOptions,
} from './types';

function createRouteOptions(
  routeObject: RouteObject,
  options: RouteTreeOptions,
): TanstackRouteOptions {
  const modernRouteObject = routeObject as ModernRouteObject;
  const revalidationState: RouteRevalidationState = {};
  const shouldRevalidate = modernRouteObject.shouldRevalidate;
  const shouldReload = createModernShouldReload(
    shouldRevalidate,
    revalidationState,
  );
  const component = toRouteComponent(routeObject);
  const base: TanstackRouteOptions = {
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

  return base;
}

function createRouteFromDescriptor(
  descriptor: RouteDescriptor<RouteObject>,
  parent: AnyRoute,
  options: RouteTreeOptions,
): AnyRoute {
  const { source, location, children } = descriptor;
  const routeOptions = createRouteOptions(source, options);
  const route = createTanstackRoute({
    ...routeOptions,
    ...location,
    getParentRoute: () => parent,
  });
  wrapRouteComponentWithModernContext(route, routeOptions.component, source.id);
  if (children.length) {
    route.addChildren(
      children.map(child => createRouteFromDescriptor(child, route, options)),
    );
  }
  return route;
}

export function createRouteTreeFromRouteObjects(
  routes: RouteObject[],
  options: RouteTreeOptions = {},
): ModernTanstackRootRoute {
  const { root, children } = describeRouteTree(routes);
  const rootRouteOptions: TanstackRootRouteOptions = {
    ...(root ? createRouteOptions(root, options) : {}),
    notFoundComponent: DefaultNotFound,
  };
  const rootRoute = createTanstackRootRoute(rootRouteOptions);
  if (rootRouteOptions.component) {
    rootRoute.options.component = withModernRouteMatchContext(
      rootRouteOptions.component,
      rootRouteId,
    ) as typeof rootRoute.options.component;
  }
  rootRoute.addChildren(
    children.map(child => createRouteFromDescriptor(child, rootRoute, options)),
  );
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
