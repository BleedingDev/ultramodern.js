// @effect-diagnostics globalConsole:off strictBooleanExpressions:off
import {
  getGlobalEnableRsc,
  InternalRuntimeContext,
  type TInternalRuntimeContext,
} from '@modern-js/runtime/context';
import type { RouteObject } from '@modern-js/runtime-utils/router';
import { normalizePathname } from '@modern-js/runtime-utils/url';
import {
  type AnyRouter,
  createBrowserHistory,
  createHashHistory,
  createRouter,
  RouterProvider,
  useLocation,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import { useContext, useMemo } from 'react';
import { createModernBasepathRewrite } from './basepathRewrite';
import { wrapRouterSubscribeWithBlockState } from './blockingSubscribe';
import { isSegmentPrefix } from './clientBasepath';
import {
  getTanstackSsrHydrationPromise,
  hasTanstackSsrHydrationRecord,
  ModernRouterClient,
  type WindowWithTanstackSsr,
} from './clientHydration';
import { routerProviderRegistryHooks } from './hooks';
import { wrapTanstackSsrHydrationBoundary } from './hydrationBoundary';
import {
  applyRouterRuntimeState,
  type RouterLifecycleContext,
} from './lifecycle';
import {
  createTanstackRouteObjects,
  getMergedRouterConfig,
  getTanstackRouteConfig,
  joinBasename,
  type TanstackRouterPluginAPI,
  type TanstackRouterRuntimePlugin,
} from './pluginShared';
import { Link } from './prefetchLink';
import { useMatches } from './routeHooks';
import { createRouteTreeFromRouteObjects } from './routeTree';
import { getTanstackRscSerializationAdapters } from './rsc/client';
import {
  getModernTanstackRouterFastDefaults,
  type RouterConfig,
} from './types';

export const tanstackRouterPlugin = (
  userConfig: Partial<RouterConfig> = {},
): TanstackRouterRuntimePlugin => {
  const plugin: TanstackRouterRuntimePlugin = {
    name: '@modern-js/plugin-router-tanstack',
    registryHooks: routerProviderRegistryHooks,
    setup: (api: TanstackRouterPluginAPI) => {
      const hooks = api.getHooks();
      let cachedRouteObjects: RouteObject[] | undefined;
      let cachedRouteTree: ReturnType<
        typeof createRouteTreeFromRouteObjects
      > | null = null;
      let cachedRouter: AnyRouter | null = null;
      let cachedRouterBasepath: string | null = null;

      const getMergedConfig = () => getMergedRouterConfig(api, userConfig);

      const getRouteObjects = () => {
        if (typeof cachedRouteObjects !== 'undefined') {
          return cachedRouteObjects;
        }

        cachedRouteObjects = createTanstackRouteObjects({
          hooks,
          routeConfig: getTanstackRouteConfig(api, userConfig),
        });
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
          ? joinBasename(
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
        const routerFastDefaults =
          getModernTanstackRouterFastDefaults(mergedConfig);

        cachedRouter = createRouter({
          ...routerFastDefaults,
          ...(serializationAdapters ? { defaultStructuralSharing: false } : {}),
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

      api.onBeforeRender(context => {
        const mergedConfig = getMergedConfig();
        if (
          typeof window !== 'undefined' &&
          (window as { _SSR_DATA?: unknown })._SSR_DATA !== undefined &&
          mergedConfig.unstable_reloadOnURLMismatch
        ) {
          const { ssrContext } = context;
          const currentPathname = normalizePathname(window.location.pathname);
          const initialPathname =
            typeof ssrContext?.request?.pathname === 'string'
              ? normalizePathname(ssrContext.request.pathname)
              : undefined;

          if (
            initialPathname !== undefined &&
            initialPathname !== '' &&
            initialPathname !== currentPathname
          ) {
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
        if (hasSSRBootstrap && getRouteObjects().length > 0) {
          const runtimeContext = context as TInternalRuntimeContext;
          const router = getRouter(
            runtimeContext,
            getClientBasename(runtimeContext),
          );
          if (router) {
            return getTanstackSsrHydrationPromise(router).then(() => undefined);
          }
        }

        return;
      });

      api.wrapRoot(App => {
        if (getRouteObjects().length === 0) {
          return App;
        }

        const RouterWrapper = () => {
          const runtimeContext = useContext(
            InternalRuntimeContext,
          ) as TInternalRuntimeContext;

          const _basename = getClientBasename(runtimeContext);

          const routeTree = useMemo(() => getRouteTree(), []);

          if (!routeTree) {
            return App ? <App /> : null;
          }

          const router = useMemo(
            () => getRouter(runtimeContext, _basename),
            [_basename, routeTree, runtimeContext],
          );
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
          if (hasSSRBootstrap) {
            hooks.onBeforeHydrateRouter.call({
              ...lifecycleContext,
              phase: 'hydrate',
              router,
              runtimeContext: runtimeState,
            });
          }

          const RouterContent = hasSSRBootstrap ? (
            <ModernRouterClient router={router} />
          ) : (
            <RouterProvider router={router} />
          );
          const HydratableRouterContent = wrapTanstackSsrHydrationBoundary(
            RouterContent,
            hasSSRBootstrap,
          );
          if (hasSSRBootstrap) {
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
