// @effect-diagnostics strictBooleanExpressions:off

import { type AnyRouter, RouterProvider } from '@tanstack/react-router';
import { createElement } from 'react';
import { withModernRouteMatchContext } from './outlet';
import { pickRouteModuleComponent } from './routeTree';

export type WindowWithTanstackSsr = Window & {
  $_TSR?: unknown;
};

type RouteComponentPreloadable = {
  load?: () => Promise<unknown>;
  preload?: () => Promise<unknown>;
};

type RouterWithPreloadableRoutes = AnyRouter & {
  routesById?: Record<
    string,
    {
      options?: {
        component?: unknown;
        staticData?: {
          modernRouteId?: string;
        };
      };
    }
  >;
};

type RouterHydrationRecord = {
  error?: unknown;
  promise: Promise<unknown>;
  status: 'pending' | 'fulfilled' | 'rejected';
};

const routerHydrationRecords = new WeakMap<AnyRouter, RouterHydrationRecord>();
const routeModulesKey = '_routeModules';

function getCachedRouteModule(routeId: string) {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return (window as unknown as Record<string, Record<string, unknown>>)[
    routeModulesKey
  ]?.[routeId];
}

function preloadHydratedRouteComponents(router: AnyRouter): Promise<void> {
  const preloadableRouter = router as RouterWithPreloadableRoutes;
  const routesById = preloadableRouter.routesById || {};
  const matches = preloadableRouter.stores.matches.get() as Array<{
    routeId?: string;
  }>;

  return Promise.all(
    matches.map(match => {
      if (match.routeId === undefined || match.routeId === '') {
        return undefined;
      }
      const route = routesById[match.routeId];
      const component = route?.options?.component as RouteComponentPreloadable;
      const preload = component?.load || component?.preload;
      if (typeof preload !== 'function') {
        return undefined;
      }
      return Promise.resolve(preload.call(component)).then(routeModule => {
        const modernRouteId = route?.options?.staticData?.modernRouteId;
        const cachedRouteModule =
          typeof modernRouteId === 'string' && modernRouteId !== ''
            ? getCachedRouteModule(modernRouteId)
            : undefined;
        const resolvedComponent = pickRouteModuleComponent(
          cachedRouteModule ?? routeModule,
        );
        if (
          resolvedComponent !== undefined &&
          typeof modernRouteId === 'string' &&
          modernRouteId !== ''
        ) {
          route.options.component = withModernRouteMatchContext(
            resolvedComponent,
            modernRouteId,
          );
        }
      });
    }),
  ).then(() => undefined);
}

export function hydrateTanstackRouter(router: AnyRouter) {
  return import('@tanstack/react-router/ssr/client').then(({ hydrate }) =>
    hydrate(router),
  );
}

function getTanstackSsrHydrationRecord(router: AnyRouter) {
  const existingHydrationRecord = routerHydrationRecords.get(router);
  if (existingHydrationRecord !== undefined) {
    return existingHydrationRecord;
  }

  const hydrationRecord: RouterHydrationRecord = {
    promise: Promise.resolve(),
    status: 'pending',
  };
  routerHydrationRecords.set(router, hydrationRecord);
  try {
    hydrationRecord.promise = hydrateTanstackRouter(router)
      .then(value => preloadHydratedRouteComponents(router).then(() => value))
      .then(
        value => {
          hydrationRecord.status = 'fulfilled';
          return value;
        },
        error => {
          hydrationRecord.status = 'rejected';
          hydrationRecord.error = error;
          throw error;
        },
      );
  } catch (error) {
    hydrationRecord.status = 'rejected';
    hydrationRecord.error = error;
    hydrationRecord.promise = Promise.reject(error);
    hydrationRecord.promise.catch(() => {});
  }
  return hydrationRecord;
}

export function getTanstackSsrHydrationPromise(router: AnyRouter) {
  return getTanstackSsrHydrationRecord(router).promise;
}

export function hasTanstackSsrHydrationRecord(router: AnyRouter) {
  return routerHydrationRecords.has(router);
}

export function ModernRouterClient({ router }: { router: AnyRouter }) {
  const hydrationRecord = getTanstackSsrHydrationRecord(router);
  if (hydrationRecord.status === 'pending') {
    throw hydrationRecord.promise;
  }
  if (hydrationRecord.status === 'rejected') {
    throw hydrationRecord.error;
  }
  return createElement(RouterProvider, { router });
}
