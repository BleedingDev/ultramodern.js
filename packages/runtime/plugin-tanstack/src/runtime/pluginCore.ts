import {
  getGlobalLayoutApp,
  getGlobalRoutes,
  type TInternalRuntimeContext,
} from '@modern-js/runtime/context';
import { merge } from '@modern-js/runtime-utils/merge';
import type { RouterExtendsHooks } from './hooks';
import type { RouterConfig } from './types';

export type TanstackRouterRuntimeConfig = {
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

export function getMergedRouterConfig(
  api: TanstackRouterPluginAPI,
  userConfig: Partial<RouterConfig>,
): RouterConfig {
  const pluginConfig = api.getRuntimeConfig() as {
    router?: Partial<RouterConfig>;
  };
  return merge(pluginConfig.router || {}, userConfig) as RouterConfig;
}

export function getFinalRouteConfig(
  mergedConfig: RouterConfig,
): RouterConfig['routesConfig'] {
  return {
    routes: getGlobalRoutes() as RouterConfig['routesConfig']['routes'],
    globalApp: getGlobalLayoutApp(),
    ...mergedConfig.routesConfig,
  };
}
