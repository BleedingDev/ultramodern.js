import {
  getGlobalLayoutApp,
  getGlobalRoutes,
  type TInternalRuntimeContext,
} from '@modern-js/runtime/context';
import { merge } from '@modern-js/runtime-utils/merge';
import type { RouteObject } from '@modern-js/runtime-utils/router';
import type { RouterExtendsHooks } from './hooks';
import type { RouterConfig } from './types';
import { createTanstackRouteObjectsFromConfig } from './utils';

type TanstackRouterRuntimeConfig = {
  plugins?: TanstackRouterRuntimePlugin[];
  router?: Partial<RouterConfig>;
  [key: string]: unknown;
};

type RuntimeInterrupt = (value?: unknown) => unknown;

export type TanstackRouterPluginAPI = {
  getRuntimeConfig: () => TanstackRouterRuntimeConfig;
  getHooks: () => RouterExtendsHooks;
  onBeforeRender: (
    listener: (
      context: TInternalRuntimeContext,
      interrupt: RuntimeInterrupt,
    ) => unknown,
  ) => void;
  wrapRoot: (listener: (App: any) => any) => void;
  [key: string]: any;
};

export type TanstackRouterRuntimePlugin = {
  name?: string;
  registryHooks?: RouterExtendsHooks;
  setup?: (api: TanstackRouterPluginAPI) => unknown;
  [key: string]: unknown;
};

type TanstackRouteConfig = {
  mergedConfig: RouterConfig;
  finalRouteConfig: RouterConfig['routesConfig'];
  hasConfiguredRoutes: boolean;
};

export function getMergedRouterConfig(
  api: TanstackRouterPluginAPI,
  userConfig: Partial<RouterConfig>,
): RouterConfig {
  const pluginConfig = api.getRuntimeConfig() as {
    router?: Partial<RouterConfig>;
  };
  return merge(pluginConfig.router || {}, userConfig) as RouterConfig;
}

function getFinalRouteConfig(
  mergedConfig: RouterConfig,
): RouterConfig['routesConfig'] {
  return {
    routes: getGlobalRoutes() as RouterConfig['routesConfig']['routes'],
    globalApp: getGlobalLayoutApp(),
    ...mergedConfig.routesConfig,
  };
}

export function getTanstackRouteConfig(
  api: TanstackRouterPluginAPI,
  userConfig: Partial<RouterConfig>,
): TanstackRouteConfig {
  const mergedConfig = getMergedRouterConfig(api, userConfig);
  const finalRouteConfig = getFinalRouteConfig(mergedConfig);
  return {
    mergedConfig,
    finalRouteConfig,
    hasConfiguredRoutes:
      Boolean(finalRouteConfig.routes) || Boolean(mergedConfig.createRoutes),
  };
}

export function createTanstackRouteObjects({
  hooks,
  routeConfig,
}: {
  hooks: RouterExtendsHooks;
  routeConfig: TanstackRouteConfig;
}): RouteObject[] {
  const { mergedConfig, finalRouteConfig } = routeConfig;
  const routeObjects =
    mergedConfig.createRoutes !== undefined
      ? mergedConfig.createRoutes()
      : (createTanstackRouteObjectsFromConfig({
          routesConfig: finalRouteConfig,
        }) ?? []);

  return hooks.modifyRoutes.call(routeObjects) as RouteObject[];
}

export function joinBasename(baseUrl: string, basename: string): string {
  const base = baseUrl || '/';
  const normalizedBase = base.startsWith('/') ? base : `/${base}`;
  const trimmedBase =
    normalizedBase.length > 1
      ? normalizedBase.replace(/\/+$/g, '')
      : normalizedBase;
  const trimmedBasename = basename.replace(/^\/+|\/+$/g, '');
  if (trimmedBasename.length === 0) {
    return trimmedBase || '/';
  }
  return `${trimmedBase}/${trimmedBasename}`.replace(/\/{2,}/g, '/');
}
