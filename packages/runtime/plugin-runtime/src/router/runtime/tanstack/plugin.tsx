/// <reference path="./ssr-shim.d.ts" />

import { merge } from '@modern-js/runtime-utils/merge';
import type { RouteObject } from '@modern-js/runtime-utils/router';
import {
  createBrowserHistory,
  createHashHistory,
  createRouter,
  RouterProvider,
  useLocation,
  useMatches,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import { RouterClient } from '@tanstack/react-router/ssr/client';
import * as React from 'react';
import { useContext, useMemo } from 'react';
import type { RuntimePlugin } from '../../../core';
import {
  getGlobalLayoutApp,
  getGlobalRoutes,
  InternalRuntimeContext,
} from '../../../core/context';
import {
  onAfterCreateRouter as onAfterCreateRouterHook,
  onAfterHydrateRouter as onAfterHydrateRouterHook,
  onBeforeCreateRouter as onBeforeCreateRouterHook,
  onBeforeHydrateRouter as onBeforeHydrateRouterHook,
  type RouterExtendsHooks,
} from '../hooks';
import {
  applyRouterRuntimeState,
  type RouterLifecycleContext,
} from '../lifecycle';
import type { RouterConfig } from '../types';
import { createRouteObjectsFromConfig, urlJoin } from '../utils';
import { createModernBasepathRewrite } from './basepathRewrite';
import { createRouteTreeFromRouteObjects } from './routeTree';

function normalizeBase(b: string) {
  if (b.length > 1 && b.endsWith('/')) return b.slice(0, -1);
  return b || '/';
}

function isSegmentPrefix(pathname: string, base: string) {
  const b = normalizeBase(base);
  const p = pathname || '/';
  return p === b || p.startsWith(`${b}/`);
}

function stripSyntheticNotFoundRoute(routes: RouteObject[]): RouteObject[] {
  return routes
    .filter(route => !(route.path === '*' && !route.id && !route.loader))
    .map(route => {
      if (!route.children?.length) {
        return route;
      }
      return {
        ...route,
        children: stripSyntheticNotFoundRoute(route.children),
      };
    });
}

export const tanstackRouterPlugin = (
  userConfig: Partial<RouterConfig> = {},
): RuntimePlugin<{
  extendHooks: RouterExtendsHooks;
}> => {
  return {
    name: '@modern-js/plugin-router-tanstack',
    registryHooks: {
      onAfterCreateRouter: onAfterCreateRouterHook,
      onAfterHydrateRouter: onAfterHydrateRouterHook,
      onBeforeCreateRouter: onBeforeCreateRouterHook,
      onBeforeHydrateRouter: onBeforeHydrateRouterHook,
    },
    setup: api => {
      api.onBeforeRender(context => {
        context.router = {
          useMatches,
          useLocation,
          useNavigate,
          useRouter,
        };
      });

      api.wrapRoot(App => {
        const mergedConfig = merge(
          api.getRuntimeConfig().router || {},
          userConfig,
        ) as RouterConfig;

        const {
          serverBase = [],
          supportHtml5History = true,
          basename = '',
          routesConfig,
          createRoutes,
        } = mergedConfig;

        const finalRouteConfig = {
          routes: getGlobalRoutes(),
          globalApp: getGlobalLayoutApp(),
          ...routesConfig,
        };

        if (!finalRouteConfig.routes && !createRoutes) {
          return App;
        }

        const hooks = api.getHooks() as any;

        let cachedRouteObjects: RouteObject[] | undefined;

        const getRouteObjects = () => {
          if (typeof cachedRouteObjects !== 'undefined') {
            return cachedRouteObjects;
          }

          const routeObjects = createRoutes
            ? createRoutes()
            : createRouteObjectsFromConfig({
                routesConfig: finalRouteConfig,
              }) || [];

          const normalizedRouteObjects = createRoutes
            ? routeObjects
            : stripSyntheticNotFoundRoute(routeObjects);

          cachedRouteObjects = hooks.modifyRoutes.call(
            normalizedRouteObjects,
          ) as RouteObject[];
          return cachedRouteObjects;
        };

        const selectBasePath = (pathname: string) => {
          const match = serverBase.find(baseUrl =>
            isSegmentPrefix(pathname, baseUrl),
          );
          return match || '/';
        };

        // Cache routeTree/router in closure to avoid recreating on re-render
        let cachedRouteTree: any = null;
        let cachedRouter: any = null;
        let cachedRouterBasepath: string | null = null;

        const RouterWrapper = () => {
          const runtimeContext = useContext(InternalRuntimeContext);

          const baseUrl = selectBasePath(location.pathname).replace(
            /^\/*/,
            '/',
          );
          const _basename =
            baseUrl === '/'
              ? urlJoin(
                  baseUrl,
                  runtimeContext._internalRouterBaseName || basename || '',
                )
              : baseUrl;

          const routeTree = useMemo(() => {
            if (cachedRouteTree) {
              return cachedRouteTree;
            }
            const routeObjects = getRouteObjects();
            if (!routeObjects.length) {
              return null;
            }
            cachedRouteTree = createRouteTreeFromRouteObjects(routeObjects);
            return cachedRouteTree;
          }, []);

          if (!routeTree) {
            return App ? <App /> : null;
          }

          const router = useMemo(() => {
            const lifecycleContext: RouterLifecycleContext = {
              framework: 'tanstack',
              phase: 'client-create',
              routes: getRouteObjects(),
              runtimeContext,
              basename: _basename,
            };
            hooks.onBeforeCreateRouter.call(lifecycleContext);

            if (cachedRouter && cachedRouterBasepath === _basename) {
              hooks.onAfterCreateRouter.call({
                ...lifecycleContext,
                router: cachedRouter,
                runtimeContext,
              });
              return cachedRouter;
            }

            const history = supportHtml5History
              ? createBrowserHistory()
              : createHashHistory();

            const rewrite = createModernBasepathRewrite(_basename);

            cachedRouter = createRouter({
              routeTree,
              basepath: '/',
              rewrite,
              history,
              context: {},
            });
            cachedRouterBasepath = _basename;
            hooks.onAfterCreateRouter.call({
              ...lifecycleContext,
              router: cachedRouter,
              runtimeContext,
            });

            return cachedRouter;
          }, [_basename, routeTree, supportHtml5History, runtimeContext]);
          const runtimeState = applyRouterRuntimeState(runtimeContext, {
            framework: 'tanstack',
            basename: _basename,
            instance: router,
          });
          const lifecycleContext: RouterLifecycleContext = {
            framework: 'tanstack',
            phase: 'client-create',
            routes: getRouteObjects(),
            runtimeContext: runtimeState,
            basename: _basename,
            router,
          };

          // TanStack SSR hydration sets window.$_TSR. If present, use RouterClient to hydrate.
          const hasSSRBootstrap =
            typeof window !== 'undefined' && (window as any).$_TSR;
          if (hasSSRBootstrap) {
            hooks.onBeforeHydrateRouter.call({
              ...lifecycleContext,
              phase: 'hydrate',
              router,
              runtimeContext: runtimeState,
            });
          }

          const RouterContent = hasSSRBootstrap ? (
            <React.Suspense fallback={null}>
              <RouterClient router={router} />
            </React.Suspense>
          ) : (
            <RouterProvider router={router} />
          );
          if (hasSSRBootstrap) {
            hooks.onAfterHydrateRouter.call({
              ...lifecycleContext,
              phase: 'hydrate',
              router,
              runtimeContext: runtimeState,
            });
          }

          return App ? <App>{RouterContent}</App> : RouterContent;
        };

        return RouterWrapper as any;
      });
    },
  };
};
