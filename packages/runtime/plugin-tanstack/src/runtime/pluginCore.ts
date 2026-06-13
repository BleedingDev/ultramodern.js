import type { Plugin, RuntimePluginExtends } from '@modern-js/plugin';
import type { RuntimePluginAPI } from '@modern-js/plugin/runtime';
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

type TanstackRouterRuntimeExtends = Required<
  RuntimePluginExtends<TanstackRouterRuntimeConfig, TInternalRuntimeContext>
> & {
  extendHooks: RouterExtendsHooks;
};

export type TanstackRouterPluginAPI =
  RuntimePluginAPI<TanstackRouterRuntimeExtends>;

export type TanstackRouterRuntimePlugin = Plugin<
  TanstackRouterPluginAPI,
  TInternalRuntimeContext
>;

export function getMergedRouterConfig(
  api: TanstackRouterPluginAPI,
  userConfig: Partial<RouterConfig>,
): RouterConfig {
  const pluginConfig = api.getRuntimeConfig() as {
    router?: Partial<RouterConfig>;
  };
  return merge(pluginConfig.router || {}, userConfig) as RouterConfig;
}

export function getFinalRouteConfig(mergedConfig: RouterConfig) {
  return {
    routes: getGlobalRoutes(),
    globalApp: getGlobalLayoutApp(),
    ...mergedConfig.routesConfig,
  };
}
