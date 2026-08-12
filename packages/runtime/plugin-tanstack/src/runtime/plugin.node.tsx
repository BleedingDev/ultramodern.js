// @effect-diagnostics asyncFunction:off newPromise:off strictBooleanExpressions:off unnecessaryArrowBlock:off
import {
  getGlobalEnableRsc,
  type InternalRouterServerSnapshot,
  InternalRuntimeContext,
  type TInternalRuntimeContext,
} from '@modern-js/runtime/context';
import {
  createRequestContext,
  type RequestContext,
} from '@modern-js/runtime-utils/node';
import { time } from '@modern-js/runtime-utils/time';
import { LOADER_REPORTER_NAME } from '@modern-js/utils/universal/constants';
import {
  type AnyRouter,
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import type React from 'react';
import { useContext } from 'react';
import { createModernBasepathRewrite } from './basepathRewrite';
import { routerProviderRegistryHooks } from './hooks';
import { wrapTanstackSsrHydrationBoundary } from './hydrationBoundary';
import {
  applyRouterServerPrepareResult,
  createRouterServerSnapshot,
  getRouterRuntimeState,
  type RouterLifecycleContext,
} from './lifecycle';
import {
  createTanstackRouteObjects,
  getTanstackRouteConfig,
  joinBasename,
  type TanstackRouterPluginAPI,
  type TanstackRouterRuntimePlugin,
} from './pluginShared';
import {
  createRouteTreeFromRouteObjects,
  getModernRouteIdsFromMatches,
} from './routeTree';
import {
  createTanstackRscServerPayload,
  handleTanstackRscRedirect,
} from './rsc/payloadRouter';
import {
  getTanstackRscRouter,
  setTanstackRscRouter,
  setTanstackRscServerPayload,
} from './rsc/payloadStorage';
import {
  attachServerSsrUtils,
  collectRouterErrors,
  createGetSsrHref,
  routerManagedTagsToHtml,
  waitForRouterSerialization,
} from './ssrManagedTags';
import { preloadMatchedRouteComponents } from './ssrPreload';
import type {
  ModernTanstackRouterContext,
  TanstackRouterWithServerSsr,
} from './ssrTypes';
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
      api.onBeforeRender(async (context, interrupt) => {
        const routeConfig = getTanstackRouteConfig(api, userConfig);
        const { mergedConfig } = routeConfig;
        const enableRsc = getGlobalEnableRsc();
        const serializationAdapters = enableRsc
          ? (await import('./rsc/server')).getTanstackRscSerializationAdapters()
          : undefined;

        const { basename = '' } = mergedConfig;

        if (!routeConfig.hasConfiguredRoutes) {
          return;
        }

        const hooks = api.getHooks();
        await hooks.onBeforeCreateRoutes.call(context);

        const modifiedRouteObjects = createTanstackRouteObjects({
          hooks,
          routeConfig,
        });

        if (!modifiedRouteObjects.length) {
          return;
        }

        const {
          request,
          nonce,
          baseUrl,
          loaderFailureMode = 'errorBoundary',
        } = context.ssrContext!;

        const _basename =
          baseUrl === '/' ? joinBasename(baseUrl, basename || '') : baseUrl;

        const rawRequest = request.raw as Request;
        const initialHref = createGetSsrHref(rawRequest);
        const isRSCNavigation =
          enableRsc && rawRequest.headers.get('x-rsc-tree') === 'true';

        const requestContext = createRequestContext(
          context.ssrContext?.loaderContext,
        ) as RequestContext<Record<string, unknown>>;

        const controller = new AbortController();
        const ssrRequest = new Request(rawRequest.url, {
          method: 'GET',
          headers: rawRequest.headers,
          signal: controller.signal,
        });

        const routerContext: ModernTanstackRouterContext = {
          request: ssrRequest,
          requestContext,
        };

        const routeTree = createRouteTreeFromRouteObjects(modifiedRouteObjects);
        const history = createMemoryHistory({
          initialEntries: [initialHref],
        });

        const rewrite = createModernBasepathRewrite(_basename);
        const routerLifecycleContext: RouterLifecycleContext = {
          framework: 'tanstack',
          phase: 'ssr-prepare',
          routes: modifiedRouteObjects,
          runtimeContext: context as TInternalRuntimeContext,
          basename: _basename,
        };
        hooks.onBeforeCreateRouter.call(routerLifecycleContext);

        const tanstackRouter = createRouter({
          ...getModernTanstackRouterFastDefaults(mergedConfig),
          routeTree,
          history,
          basepath: '/',
          rewrite,
          origin: new URL(rawRequest.url).origin,
          ssr: { nonce },
          context: routerContext as never,
          ...(serializationAdapters ? { serializationAdapters } : {}),
        });
        const serverRouter =
          tanstackRouter as unknown as TanstackRouterWithServerSsr;
        if (enableRsc) {
          setTanstackRscRouter(serverRouter);
        }

        await attachServerSsrUtils(serverRouter);

        const end = time();

        try {
          await tanstackRouter.load({ sync: true });
        } finally {
          const cost = end();
          context.ssrContext?.onTiming?.(LOADER_REPORTER_NAME, cost);
        }

        const serverLoadResult = serverRouter._serverResult;
        if (!serverLoadResult) {
          try {
            serverRouter.serverSsr?.cleanup?.();
          } catch {}
          throw new Error(
            'TanStack Router completed an SSR load without a server result.',
          );
        }

        if (serverLoadResult.type === 'redirect') {
          const { redirect } = serverLoadResult;

          try {
            serverRouter.serverSsr?.cleanup?.();
          } catch {}

          return interrupt(
            isRSCNavigation
              ? handleTanstackRscRedirect(
                  redirect.headers,
                  _basename,
                  redirect.status,
                )
              : redirect,
          );
        }

        const routerErrors = collectRouterErrors(tanstackRouter);
        if (routerErrors && loaderFailureMode === 'clientRender') {
          (
            context.ssrContext?.response as
              | { status: (code: number) => void }
              | undefined
          )?.status(200);
          try {
            serverRouter.serverSsr?.cleanup?.();
          } catch {}
          throw Object.values(routerErrors)[0];
        }

        await preloadMatchedRouteComponents(serverRouter);

        (
          context.ssrContext?.response as
            | { status: (code: number) => void }
            | undefined
        )?.status(serverLoadResult.status);

        await serverRouter.serverSsr?.dehydrate?.();

        if (enableRsc) {
          if (isRSCNavigation) {
            // RSC navigations consume the server payload directly. Normal HTML SSR
            // emits the buffered bootstrap script below and must not wait here
            // because Modern's non-streaming hook has not rendered the app yet.
            await waitForRouterSerialization(serverRouter);
          }

          setTanstackRscServerPayload(
            createTanstackRscServerPayload(serverRouter, {
              omitClientLoaderData: isRSCNavigation,
            }),
          );
        }

        const ssrScriptTags = serverRouter.serverSsr?.takeBufferedScripts?.();
        const hydrationScripts = routerManagedTagsToHtml(ssrScriptTags);
        const matchedRouteIds = getModernRouteIdsFromMatches(serverRouter);
        const routerServerSnapshot: InternalRouterServerSnapshot =
          createRouterServerSnapshot({
            framework: 'tanstack',
            basename: _basename,
            statusCode: serverLoadResult.status,
            errors: routerErrors,
            matchedRouteIds,
            hydrationScripts,
          });
        const runtimeContext = applyRouterServerPrepareResult(
          context as TInternalRuntimeContext,
          {
            snapshot: routerServerSnapshot,
            cleanup: () => serverRouter.serverSsr?.cleanup?.(),
            state: {
              framework: 'tanstack',
              basename: _basename,
              instance: serverRouter,
              hydrationScripts,
              matchedRouteIds,
              serverSnapshot: routerServerSnapshot,
            },
          },
        );
        hooks.onAfterCreateRouter.call({
          ...routerLifecycleContext,
          router: serverRouter,
          serverSnapshot: routerServerSnapshot,
          runtimeContext,
        });
      });

      api.wrapRoot(App => {
        const getRouteApp = () => {
          if (getGlobalEnableRsc()) {
            return (props => {
              const router = getTanstackRscRouter();
              if (!router) {
                return App ? <App {...props} /> : null;
              }

              const routerWrapper = wrapTanstackSsrHydrationBoundary(
                <RouterProvider router={router as AnyRouter} />,
                true,
              );

              return App ? <App>{routerWrapper}</App> : routerWrapper;
            }) as React.FC<Record<string, unknown>>;
          }

          return (props => {
            const context = useContext(
              InternalRuntimeContext,
            ) as unknown as TInternalRuntimeContext;
            const router = getRouterRuntimeState(context)?.instance;
            if (!router) {
              return App ? <App {...props} /> : null;
            }

            const routerWrapper = wrapTanstackSsrHydrationBoundary(
              <RouterProvider router={router as AnyRouter} />,
              true,
            );

            return App ? <App>{routerWrapper}</App> : routerWrapper;
          }) as React.FC<Record<string, unknown>>;
        };

        return getRouteApp();
      });
    },
  };
  return plugin;
};

export default tanstackRouterPlugin;
