// @effect-diagnostics globalConsole:off strictBooleanExpressions:off
/// <reference path="./ssr-shim.d.ts" />

import type { Plugin, RuntimePluginExtends } from '@modern-js/plugin';
import type { RuntimePluginAPI } from '@modern-js/plugin/runtime';
import {
  getGlobalEnableRsc,
  getGlobalLayoutApp,
  getGlobalRoutes,
  InternalRuntimeContext,
  type TInternalRuntimeContext,
} from '@modern-js/runtime/context';
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
import { hydrate as hydrateTanstackRouter } from '@tanstack/react-router/ssr/client';
import { useContext, useMemo } from 'react';
import { createModernBasepathRewrite } from './basepathRewrite';
import {
  modifyRoutes as modifyRoutesHook,
  onAfterCreateRouter as onAfterCreateRouterHook,
  onAfterHydrateRouter as onAfterHydrateRouterHook,
  onBeforeCreateRouter as onBeforeCreateRouterHook,
  onBeforeCreateRoutes as onBeforeCreateRoutesHook,
  onBeforeHydrateRouter as onBeforeHydrateRouterHook,
  type RouterExtendsHooks,
} from './hooks';
import { wrapTanstackSsrHydrationBoundary } from './hydrationBoundary';
import {
  applyRouterRuntimeState,
  type RouterLifecycleContext,
} from './lifecycle';
import { withModernRouteMatchContext } from './outlet';
import { Link } from './prefetchLink';
import { createRouteTreeFromRouteObjects } from './routeTree';
import { getTanstackRscSerializationAdapters } from './rsc/client';
import {
  getModernTanstackRouterFastDefaults,
  type RouterConfig,
} from './types';
import { createRouteObjectsFromConfig, urlJoin } from './utils';

const BLOCKING_SUBSCRIBE_SYMBOL = Symbol.for(
  '@modern-js/plugin-tanstack:blocking-subscribe',
);
const BLOCKING_STATE_SYMBOL = Symbol.for(
  '@modern-js/plugin-tanstack:blocking-state',
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

type RouteComponentPreloadable = {
  load?: () => Promise<unknown>;
  preload?: () => Promise<unknown>;
};

type ModernRouteModule = {
  Component?: unknown;
  default?: unknown;
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

type TanstackRouterRuntimeConfig = {
  plugins?: TanstackRouterRuntimePlugin[];
  router?: Partial<RouterConfig>;
  [key: string]: unknown;
};

type TanstackRouterRuntimeExtends = Required<
  RuntimePluginExtends<TanstackRouterRuntimeConfig, TInternalRuntimeContext>
> & {
  extendHooks: RouterExtendsHooks;
};

type TanstackRouterPluginAPI = RuntimePluginAPI<TanstackRouterRuntimeExtends>;

type TanstackRouterRuntimePlugin = Plugin<
  TanstackRouterPluginAPI,
  TInternalRuntimeContext
>;

function normalizeBase(b: string) {
  if (b.length > 1 && b.endsWith('/')) {
    return b.slice(0, -1);
  }
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

type RouterHydrationRecord = {
  error?: unknown;
  promise: Promise<unknown>;
  status: 'pending' | 'fulfilled' | 'rejected';
};

const routerHydrationRecords = new WeakMap<AnyRouter, RouterHydrationRecord>();
const routeModulesKey = '_routeModules';

function pickRouteModuleComponent(
  routeModule: unknown,
  seen: Set<unknown> = new Set(),
): unknown {
  if (
    typeof routeModule === 'function' ||
    (routeModule &&
      typeof routeModule === 'object' &&
      '$$typeof' in routeModule)
  ) {
    return routeModule;
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

function getCachedRouteModule(routeId: string) {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return (window as unknown as Record<string, Record<string, unknown>>)[
    routeModulesKey
  ]?.[routeId];
}

async function preloadHydratedRouteComponents(router: AnyRouter) {
  const preloadableRouter = router as RouterWithPreloadableRoutes;
  const routesById = preloadableRouter.routesById || {};
  const matches = preloadableRouter.stores.matches.get() as Array<{
    routeId?: string;
  }>;

  await Promise.all(
    matches.map(match => {
      if (!match.routeId) {
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
        const resolvedComponent = pickRouteModuleComponent(
          (modernRouteId && getCachedRouteModule(modernRouteId)) || routeModule,
        );
        if (resolvedComponent && modernRouteId) {
          route.options.component = withModernRouteMatchContext(
            resolvedComponent,
            modernRouteId,
          );
        }
      });
    }),
  );
}

function getTanstackSsrHydrationRecord(router: AnyRouter) {
  let hydrationRecord = routerHydrationRecords.get(router);
  if (!hydrationRecord) {
    hydrationRecord = {
      promise: Promise.resolve(),
      status: 'pending',
    };
    routerHydrationRecords.set(router, hydrationRecord);
    try {
      hydrationRecord.promise = hydrateTanstackRouter(router)
        .then(async value => {
          await preloadHydratedRouteComponents(router);
          return value;
        })
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
  }
  return hydrationRecord;
}

function getTanstackSsrHydrationPromise(router: AnyRouter) {
  return getTanstackSsrHydrationRecord(router).promise;
}

function hasTanstackSsrHydrationRecord(router: AnyRouter) {
  return routerHydrationRecords.has(router);
}

function ModernRouterClient({ router }: { router: AnyRouter }) {
  const hydrationRecord = getTanstackSsrHydrationRecord(router);
  if (hydrationRecord.status === 'rejected') {
    throw hydrationRecord.error;
  }
  return <RouterProvider router={router} />;
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
): TanstackRouterRuntimePlugin => {
  const plugin: TanstackRouterRuntimePlugin = {
    name: '@modern-js/plugin-router-tanstack',
    registryHooks: {
      modifyRoutes: modifyRoutesHook,
      onAfterCreateRouter: onAfterCreateRouterHook,
      onAfterHydrateRouter: onAfterHydrateRouterHook,
      onBeforeCreateRouter: onBeforeCreateRouterHook,
      onBeforeCreateRoutes: onBeforeCreateRoutesHook,
      onBeforeHydrateRouter: onBeforeHydrateRouterHook,
    },
    setup: (api: TanstackRouterPluginAPI) => {
      const hooks = api.getHooks();
      let cachedRouteObjects: RouteObject[] | undefined;
      let cachedRouteTree: ReturnType<
        typeof createRouteTreeFromRouteObjects
      > | null = null;
      let cachedRouter: AnyRouter | null = null;
      let cachedRouterBasepath: string | null = null;

      const getMergedConfig = () => {
        const pluginConfig = api.getRuntimeConfig() as {
          router?: Partial<RouterConfig>;
        };
        return merge(pluginConfig.router || {}, userConfig) as RouterConfig;
      };

      const getRouteObjects = () => {
        if (typeof cachedRouteObjects !== 'undefined') {
          return cachedRouteObjects;
        }

        const mergedConfig = getMergedConfig();
        const { routesConfig, createRoutes } = mergedConfig;
        const finalRouteConfig = {
          routes: getGlobalRoutes(),
          globalApp: getGlobalLayoutApp(),
          ...routesConfig,
        };

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

      const getRouteTree = () => {
        if (cachedRouteTree) {
          return cachedRouteTree;
        }

        const routeObjects = getRouteObjects();
        if (!routeObjects.length) {
          return null;
        }

        cachedRouteTree = createRouteTreeFromRouteObjects(routeObjects, {
          rscPayloadRouter: getGlobalEnableRsc(),
        });
        return cachedRouteTree;
      };

      const selectBasePath = (pathname: string) => {
        const { serverBase = [] } = getMergedConfig();
        const match = serverBase.find(baseUrl =>
          isSegmentPrefix(pathname, baseUrl),
        );
        return match || '/';
      };

      const getClientBasename = (runtimeContext: TInternalRuntimeContext) => {
        const { basename = '' } = getMergedConfig();
        const baseUrl = selectBasePath(location.pathname).replace(/^\/*/, '/');
        return baseUrl === '/'
          ? urlJoin(
              baseUrl,
              runtimeContext._internalRouterBaseName || basename || '',
            )
          : baseUrl;
      };

      const getRouter = (
        runtimeContext: TInternalRuntimeContext,
        _basename: string,
      ) => {
        const routeTree = getRouteTree();
        if (!routeTree) {
          return null;
        }

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

        const mergedConfig = getMergedConfig();
        const { supportHtml5History = true } = mergedConfig;
        const history = supportHtml5History
          ? createBrowserHistory()
          : createHashHistory();
        const rewrite = createModernBasepathRewrite(_basename);
        const serializationAdapters = getGlobalEnableRsc()
          ? getTanstackRscSerializationAdapters()
          : undefined;

        cachedRouter = createRouter({
          ...getModernTanstackRouterFastDefaults(mergedConfig),
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
      };

      api.onBeforeRender(async context => {
        const mergedConfig = getMergedConfig();
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

        const hasSSRBootstrap =
          typeof window !== 'undefined' &&
          Boolean((window as WindowWithTanstackSsr).$_TSR);
        if (hasSSRBootstrap && getRouteObjects().length) {
          const runtimeContext = context as TInternalRuntimeContext;
          const router = getRouter(
            runtimeContext,
            getClientBasename(runtimeContext),
          );
          if (router) {
            await getTanstackSsrHydrationPromise(router);
          }
        }

        return;
      });

      api.wrapRoot(App => {
        if (!getRouteObjects().length) {
          return App;
        }

        const RouterWrapper = () => {
          const runtimeContext = useContext(
            InternalRuntimeContext,
          ) as TInternalRuntimeContext;

          const _basename = getClientBasename(runtimeContext);

          const routeTree = useMemo(() => {
            return getRouteTree();
          }, []);

          if (!routeTree) {
            return App ? <App /> : null;
          }

          const router = useMemo(() => {
            return getRouter(runtimeContext, _basename);
          }, [_basename, routeTree, runtimeContext]);
          if (!router) {
            return App ? <App /> : null;
          }
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

          const hasSSRBootstrap =
            typeof window !== 'undefined' &&
            (Boolean((window as WindowWithTanstackSsr).$_TSR) ||
              hasTanstackSsrHydrationRecord(router));
          const needsRouterClient = hasSSRBootstrap;
          if (needsRouterClient) {
            hooks.onBeforeHydrateRouter.call({
              ...lifecycleContext,
              phase: 'hydrate',
              router,
              runtimeContext: runtimeState,
            });
          }

          const RouterContent = needsRouterClient ? (
            <ModernRouterClient router={router} />
          ) : (
            <RouterProvider router={router} />
          );
          const HydratableRouterContent = wrapTanstackSsrHydrationBoundary(
            RouterContent,
            hasSSRBootstrap,
          );
          if (needsRouterClient) {
            hooks.onAfterHydrateRouter.call({
              ...lifecycleContext,
              phase: 'hydrate',
              router,
              runtimeContext: runtimeState,
            });
          }

          return App ? (
            <App>{HydratableRouterContent}</App>
          ) : (
            HydratableRouterContent
          );
        };

        return RouterWrapper;
      });
    },
  };
  return plugin;
};

export default tanstackRouterPlugin;
