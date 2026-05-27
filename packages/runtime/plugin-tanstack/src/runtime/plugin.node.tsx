// @effect-diagnostics asyncFunction:off newPromise:off strictBooleanExpressions:off unnecessaryArrowBlock:off
/// <reference path="./ssr-shim.d.ts" />

import type { Plugin, RuntimePluginExtends } from '@modern-js/plugin';
import type { RuntimePluginAPI } from '@modern-js/plugin/runtime';
import {
  getGlobalEnableRsc,
  getGlobalLayoutApp,
  getGlobalRoutes,
  InternalRuntimeContext,
  type ServerPayload,
  type TInternalRuntimeContext,
} from '@modern-js/runtime/context';
import { merge } from '@modern-js/runtime-utils/merge';
import {
  createRequestContext,
  type RequestContext,
  storage,
} from '@modern-js/runtime-utils/node';
import type { RouteObject } from '@modern-js/runtime-utils/router';
import { time } from '@modern-js/runtime-utils/time';
import { LOADER_REPORTER_NAME } from '@modern-js/utils/universal/constants';
import {
  type AnyRouter,
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { attachRouterServerSsrUtils } from '@tanstack/router-core/ssr/server';
import type React from 'react';
import { Suspense, useContext } from 'react';
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
import {
  applyRouterServerPrepareResult,
  createRouterServerSnapshot,
  type RouterLifecycleContext,
} from './lifecycle';
import {
  createRouteTreeFromRouteObjects,
  getModernRouteIdsFromMatches,
} from './routeTree';
import {
  createTanstackRscServerPayload,
  handleTanstackRscRedirect,
} from './rsc/payloadRouter';
import type { InternalRouterServerSnapshot, RouterConfig } from './types';
import { createRouteObjectsFromConfig, urlJoin } from './utils';

type ModernTanstackRouterContext = {
  request: Request;
  requestContext: RequestContext<Record<string, unknown>>;
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

const setTanstackRscServerPayload = (payload: ServerPayload) => {
  const storageContext = storage.useContext?.() as
    | { serverPayload?: ServerPayload }
    | undefined;
  if (storageContext) {
    storageContext.serverPayload = payload;
  }
};

type RouterManagedTag = {
  attrs?: Record<string, unknown>;
  children?: unknown;
  tag?: unknown;
};

type RouterMatchWithError = {
  error?: unknown;
  route?: {
    id?: unknown;
    options?: RouterRouteOptions;
  };
  routeId?: unknown;
};

type RouterRouteOptions = {
  component?: unknown;
  errorComponent?: unknown;
  notFoundComponent?: unknown;
  pendingComponent?: unknown;
};

type RouterRouteWithOptions = {
  options?: RouterRouteOptions;
};

type PreloadableRouteComponent = {
  load?: (props?: Record<string, unknown>) => Promise<unknown> | unknown;
  preload?: (props?: Record<string, unknown>) => Promise<unknown> | unknown;
};

type ReactLazyRouteComponent = {
  _init?: (payload: unknown) => unknown;
  _payload?: unknown;
};

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(
    value && typeof (value as PromiseLike<unknown>).then === 'function',
  );
}

type TanstackRouterWithServerSsr = AnyRouter & {
  resolveRedirect?: (redirect: Response) => Response;
  routesById?: Record<string, RouterRouteWithOptions>;
  serverSsr?: {
    cleanup?: () => void;
    dehydrate?: () => Promise<void> | void;
    isSerializationFinished?: () => boolean;
    onSerializationFinished?: (listener: () => void) => void;
    takeBufferedScripts?: () => unknown;
  };
  state: AnyRouter['state'] & {
    matches?: unknown;
    redirect?: Response;
  };
};

function isPreloadableRouteComponent(
  component: unknown,
): component is PreloadableRouteComponent {
  if (!component || typeof component !== 'function') {
    return false;
  }

  const preloadable = component as PreloadableRouteComponent;
  return (
    typeof preloadable.load === 'function' ||
    typeof preloadable.preload === 'function'
  );
}

function isReactLazyRouteComponent(
  component: unknown,
): component is ReactLazyRouteComponent {
  return (
    Boolean(component) &&
    typeof component === 'object' &&
    typeof (component as ReactLazyRouteComponent)._init === 'function' &&
    '_payload' in component
  );
}

async function preloadReactLazyRouteComponent(
  component: ReactLazyRouteComponent,
) {
  try {
    component._init?.(component._payload);
  } catch (thrown) {
    if (!isPromiseLike(thrown)) {
      throw thrown;
    }
    await thrown;
    component._init?.(component._payload);
  }
}

async function preloadRouteComponent(component: unknown) {
  if (isReactLazyRouteComponent(component)) {
    await preloadReactLazyRouteComponent(component);
    return;
  }

  if (!isPreloadableRouteComponent(component)) {
    return;
  }

  if (typeof component.load === 'function') {
    await component.load({});
    return;
  }

  await component.preload?.({});
}

async function preloadMatchedRouteComponents(
  tanstackRouter: TanstackRouterWithServerSsr,
) {
  const matches = Array.isArray(tanstackRouter.state.matches)
    ? (tanstackRouter.state.matches as RouterMatchWithError[])
    : [];
  const routesById = tanstackRouter.routesById || {};

  await Promise.all(
    matches.map(async match => {
      const routeId =
        typeof match.routeId === 'string'
          ? match.routeId
          : typeof match.route?.id === 'string'
            ? match.route.id
            : undefined;
      const route = routeId ? routesById[routeId] : match.route;
      const options = route?.options;
      if (!options) {
        return;
      }

      await Promise.all([
        preloadRouteComponent(options.component),
        preloadRouteComponent(options.pendingComponent),
        preloadRouteComponent(options.errorComponent),
        preloadRouteComponent(options.notFoundComponent),
      ]);
    }),
  );
}

async function waitForRouterSerialization(
  tanstackRouter: TanstackRouterWithServerSsr,
) {
  const serverSsr = tanstackRouter.serverSsr;
  if (
    !serverSsr ||
    typeof serverSsr.onSerializationFinished !== 'function' ||
    serverSsr.isSerializationFinished?.()
  ) {
    return;
  }

  await new Promise<void>(resolve => {
    serverSsr.onSerializationFinished?.(resolve);
  });
}

function htmlEscapeAttr(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function routerManagedTagToHtml(tag: unknown): string {
  if (!tag || typeof tag !== 'object') {
    return '';
  }

  const managedTag = tag as RouterManagedTag;
  if (!managedTag || managedTag.tag !== 'script') {
    return '';
  }

  const attrs: Record<string, unknown> = managedTag.attrs || {};
  const attrsStr = Object.entries(attrs)
    .filter(([, v]) => v != null && v !== false)
    .map(([k, v]) => {
      const name = k === 'className' ? 'class' : k;
      if (v === true) {
        return name;
      }
      return `${name}="${htmlEscapeAttr(String(v))}"`;
    })
    .join(' ');

  const open = attrsStr.length ? `<script ${attrsStr}>` : '<script>';
  const children =
    typeof managedTag.children === 'string' ? managedTag.children : '';
  return `${open}${children}</script>`;
}

function routerManagedTagsToHtml(tags: unknown): string[] {
  const normalizedTags = Array.isArray(tags) ? tags : [tags];
  return normalizedTags.map(routerManagedTagToHtml).filter(Boolean);
}

function createGetSsrHref(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}${url.hash}`;
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

function collectRouterErrors(
  tanstackRouter: AnyRouter,
): Record<string, unknown> | undefined {
  const state = tanstackRouter.state as { matches?: unknown };
  const matches = Array.isArray(state.matches)
    ? (state.matches as RouterMatchWithError[])
    : [];
  const errors = matches.reduce((acc: Record<string, unknown>, match) => {
    if (!match.error) {
      return acc;
    }

    const routeId =
      typeof match.routeId === 'string'
        ? match.routeId
        : typeof match.route?.id === 'string'
          ? match.route.id
          : `match-${Object.keys(acc).length}`;

    acc[routeId] = match.error;
    return acc;
  }, {});

  return Object.keys(errors).length > 0 ? errors : undefined;
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
      api.onBeforeRender(async (context, interrupt) => {
        const pluginConfig = api.getRuntimeConfig() as {
          router?: Partial<RouterConfig>;
        };
        const mergedConfig = merge(
          pluginConfig.router || {},
          userConfig,
        ) as RouterConfig;
        const serializationAdapters = getGlobalEnableRsc()
          ? (await import('./rsc/server')).getTanstackRscSerializationAdapters()
          : undefined;
        const enableRsc = getGlobalEnableRsc();

        const { basename = '', routesConfig, createRoutes } = mergedConfig;

        const finalRouteConfig = {
          routes: getGlobalRoutes(),
          globalApp: getGlobalLayoutApp(),
          ...routesConfig,
        };

        if (!finalRouteConfig.routes && !createRoutes) {
          return;
        }

        const hooks = api.getHooks();
        await hooks.onBeforeCreateRoutes.call(context);

        const routeObjects = createRoutes
          ? createRoutes()
          : createRouteObjectsFromConfig({
              routesConfig: finalRouteConfig,
              ssrMode: context.ssrContext?.mode,
            }) || [];
        const normalizedRouteObjects = createRoutes
          ? routeObjects
          : stripSyntheticNotFoundRoute(routeObjects);
        const modifiedRouteObjects = hooks.modifyRoutes.call(
          normalizedRouteObjects,
        );

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
          baseUrl === '/' ? urlJoin(baseUrl, basename || '') : baseUrl;

        const initialHref = createGetSsrHref(request.raw);
        const isRSCNavigation =
          enableRsc && request.raw.headers.get('x-rsc-tree') === 'true';

        const requestContext = createRequestContext(
          context.ssrContext?.loaderContext,
        ) as RequestContext<Record<string, unknown>>;

        const controller = new AbortController();
        const ssrRequest = new Request(request.raw.url, {
          method: 'GET',
          headers: request.raw.headers,
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
          routeTree,
          history,
          basepath: '/',
          rewrite,
          origin: new URL(request.raw.url).origin,
          ssr: { nonce },
          context: routerContext as never,
          ...(serializationAdapters ? { serializationAdapters } : {}),
        });
        const serverRouter =
          tanstackRouter as unknown as TanstackRouterWithServerSsr;

        attachRouterServerSsrUtils({
          router: serverRouter,
          manifest: undefined,
        });

        const end = time();

        try {
          await tanstackRouter.load({ sync: true });
        } finally {
          const cost = end();
          context.ssrContext?.onTiming?.(LOADER_REPORTER_NAME, cost);
        }

        if (serverRouter.state.redirect) {
          const resolved = serverRouter.resolveRedirect
            ? serverRouter.resolveRedirect(serverRouter.state.redirect)
            : serverRouter.state.redirect;

          try {
            serverRouter.serverSsr?.cleanup?.();
          } catch {}

          return interrupt(
            isRSCNavigation
              ? handleTanstackRscRedirect(
                  resolved.headers,
                  _basename,
                  resolved.status,
                )
              : resolved,
          );
        }

        const routerErrors = collectRouterErrors(tanstackRouter);
        if (routerErrors && loaderFailureMode === 'clientRender') {
          context.ssrContext?.response.status(200);
          try {
            serverRouter.serverSsr?.cleanup?.();
          } catch {}
          throw Object.values(routerErrors)[0];
        }

        await preloadMatchedRouteComponents(serverRouter);

        context.ssrContext?.response.status(tanstackRouter.state.statusCode);

        await serverRouter.serverSsr?.dehydrate?.();
        await waitForRouterSerialization(serverRouter);

        if (isRSCNavigation) {
          setTanstackRscServerPayload(
            createTanstackRscServerPayload(serverRouter, {
              omitClientLoaderData: true,
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
            statusCode: tanstackRouter.state.statusCode,
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
          return (props => {
            const context = useContext(
              InternalRuntimeContext,
            ) as unknown as TInternalRuntimeContext;
            const router =
              context.routerInstance ?? context.routerRuntime?.instance;
            if (!router) {
              return App ? <App {...props} /> : null;
            }

            const routerWrapper = (
              <Suspense fallback={null}>
                <RouterProvider router={router as AnyRouter} />
              </Suspense>
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
