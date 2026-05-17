// @effect-diagnostics asyncFunction:off newPromise:off strictBooleanExpressions:off unnecessaryArrowBlock:off
/// <reference path="./ssr-shim.d.ts" />

import { merge } from '@modern-js/runtime-utils/merge';
import {
  createRequestContext,
  type RequestContext,
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
import { attachRouterServerSsrUtils } from '@tanstack/react-router/ssr/server';
import type React from 'react';
import { Suspense, useContext } from 'react';
import type { RuntimePlugin } from '../../../core';
import {
  getGlobalEnableRsc,
  getGlobalLayoutApp,
  getGlobalRoutes,
  InternalRuntimeContext,
} from '../../../core/context';
import type { TInternalRuntimeContext } from '../../../core/context/runtime';
import type { RouterExtendsHooks } from '../hooks';
import {
  applyRouterServerPrepareResult,
  createRouterServerSnapshot,
  type RouterLifecycleContext,
} from '../lifecycle';
import type { InternalRouterServerSnapshot, RouterConfig } from '../types';
import { createRouteObjectsFromConfig, urlJoin } from '../utils';
import { createModernBasepathRewrite } from './basepathRewrite';
import {
  createRouteTreeFromRouteObjects,
  getModernRouteIdsFromMatches,
} from './routeTree';

type ModernTanstackRouterContext = {
  request: Request;
  requestContext: RequestContext<Record<string, unknown>>;
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

async function preloadRouteComponent(component: unknown) {
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
): RuntimePlugin<{
  extendHooks: RouterExtendsHooks;
}> => {
  return {
    name: '@modern-js/plugin-router-tanstack',
    setup: api => {
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

        // TanStack Router expects a pathname-like href for memory history entries.
        const initialHref = createGetSsrHref(request.raw);

        const requestContext = createRequestContext(
          context.ssrContext?.loaderContext,
        ) as RequestContext<Record<string, unknown>>;

        // Avoid running actions during SSR. Keep headers/cookies for loaders.
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

          return interrupt(resolved);
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
};
