// @effect-diagnostics globalConsole:off strictBooleanExpressions:off unnecessaryArrowBlock:off
/// <reference path="./ssr-shim.d.ts" />

import { merge } from '@modern-js/runtime-utils/merge';
import type { RouteObject } from '@modern-js/runtime-utils/router';
import { normalizePathname } from '@modern-js/runtime-utils/url';
import {
  type AnyRouter,
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
  getGlobalEnableRsc,
  getGlobalLayoutApp,
  getGlobalRoutes,
  InternalRuntimeContext,
} from '../../../core/context';
import type { TInternalRuntimeContext } from '../../../core/context/runtime';
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
import { Link } from './prefetchLink';
import { createRouteTreeFromRouteObjects } from './routeTree';
import { getTanstackRscSerializationAdapters } from './rsc/client';

const BLOCKING_SUBSCRIBE_SYMBOL = Symbol.for(
  '@modern-js/plugin-runtime:tanstack-blocking-subscribe',
);
const BLOCKING_STATE_SYMBOL = Symbol.for(
  '@modern-js/plugin-runtime:tanstack-blocking-state',
);

type TanstackRouterWithSubscribe = {
  [BLOCKING_STATE_SYMBOL]?: () => boolean;
  [BLOCKING_SUBSCRIBE_SYMBOL]?: boolean;
  subscribe?: (
    eventType: string,
    listener: (...args: unknown[]) => void,
  ) => () => void;
};

type WindowWithTanstackSsr = Window & {
  $_TSR?: unknown;
};

function normalizeBase(b: string) {
  if (b.length > 1 && b.endsWith('/')) return b.slice(0, -1);
  return b || '/';
}

function isSegmentPrefix(pathname: string, base: string) {
  const b = normalizeBase(base);
  const p = pathname || '/';
  return p === b || p.startsWith(`${b}/`);
}

function wrapRouterSubscribeWithBlockState(
  router: unknown,
  getBlockNavState?: () => boolean,
) {
  if (!router || typeof router !== 'object') {
    return;
  }

  const target = router as TanstackRouterWithSubscribe;
  target[BLOCKING_STATE_SYMBOL] = getBlockNavState;
  if (
    target[BLOCKING_SUBSCRIBE_SYMBOL] ||
    typeof target.subscribe !== 'function'
  ) {
    return;
  }

  const originSubscribe = target.subscribe.bind(target);
  target.subscribe = (eventType, listener) => {
    const wrappedListener = (...args: unknown[]) => {
      const blockRoute = target[BLOCKING_STATE_SYMBOL]?.() || false;
      if (blockRoute) {
        return;
      }
      return listener(...args);
    };
    return originSubscribe(eventType, wrappedListener);
  };
  target[BLOCKING_SUBSCRIBE_SYMBOL] = true;
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
        const pluginConfig = api.getRuntimeConfig() as {
          router?: Partial<RouterConfig>;
        };
        const mergedConfig = merge(
          pluginConfig.router || {},
          userConfig,
        ) as RouterConfig;
        if (
          typeof window !== 'undefined' &&
          (window as { _SSR_DATA?: unknown })._SSR_DATA &&
          mergedConfig.unstable_reloadOnURLMismatch
        ) {
          const { ssrContext } = context;
          const currentPathname = normalizePathname(window.location.pathname);
          const initialPathname =
            ssrContext?.request?.pathname &&
            normalizePathname(ssrContext.request.pathname);

          if (initialPathname && initialPathname !== currentPathname) {
            const errorMsg = `The initial URL ${initialPathname} and the URL ${currentPathname} to be hydrated do not match, reload.`;
            console.error(errorMsg);
            window.location.reload();
          }
        }

        context.router = {
          Link,
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

        const hooks = api.getHooks();

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
        let cachedRouteTree: ReturnType<
          typeof createRouteTreeFromRouteObjects
        > | null = null;
        let cachedRouter: AnyRouter | null = null;
        let cachedRouterBasepath: string | null = null;

        const RouterWrapper = () => {
          const runtimeContext = useContext(
            InternalRuntimeContext,
          ) as TInternalRuntimeContext;

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
              wrapRouterSubscribeWithBlockState(
                cachedRouter,
                runtimeContext.unstable_getBlockNavState,
              );
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
            const serializationAdapters = getGlobalEnableRsc()
              ? getTanstackRscSerializationAdapters()
              : undefined;

            cachedRouter = createRouter({
              routeTree,
              basepath: '/',
              rewrite,
              history,
              context: {},
              ...(serializationAdapters ? { serializationAdapters } : {}),
            });
            cachedRouterBasepath = _basename;
            wrapRouterSubscribeWithBlockState(
              cachedRouter,
              runtimeContext.unstable_getBlockNavState,
            );
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
            typeof window !== 'undefined' &&
            Boolean((window as WindowWithTanstackSsr).$_TSR);
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

        return RouterWrapper;
      });
    },
  };
};
