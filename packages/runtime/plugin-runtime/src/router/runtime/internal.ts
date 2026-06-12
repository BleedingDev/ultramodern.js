// @effect-diagnostics unnecessaryArrowBlock:off
import { merge } from '@modern-js/runtime-utils/merge';
import type { RuntimePlugin } from '../../core';
import type { RouterExtendsHooks } from './hooks';
import { routerPlugin as reactRouterPlugin } from './plugin';
import {
  registerRouterProvider,
  reportUnsupportedProviderRegistryHooks,
  resolveRouterProvider,
  routerProviderRegistryHooks,
} from './provider';
import type { RouterConfig, SingleRouteConfig } from './types';

registerRouterProvider('react-router', reactRouterPlugin, { isDefault: true });

export const routerPlugin = (
  userConfig: Partial<RouterConfig> = {},
): RuntimePlugin<{
  extendHooks: RouterExtendsHooks;
}> => {
  return {
    name: '@modern-js/plugin-router',
    registryHooks: routerProviderRegistryHooks,
    setup: api => {
      const mergedConfig = merge(
        api.getRuntimeConfig().router || {},
        userConfig,
      ) as RouterConfig;

      // Pass our own react-router provider as the local default: the registry
      // is realm-global, so without this an app-level Module Federation
      // remote would resolve the HOST's first-registered copy, whose closures
      // read the host's global context and render the host's routes inside
      // the remote (observed as the bridged remote rendering the consumer
      // app and crashing in its providers).
      const pluginFactory = resolveRouterProvider(mergedConfig.framework, {
        localDefault: { name: 'react-router', factory: reactRouterPlugin },
      });
      const providerPlugin = pluginFactory(userConfig);

      // The provider plugin is invoked through `setup` only — it is never
      // registered with the plugin manager, and the runtime plugin API offers
      // no way to register hooks after init. The provider contract therefore
      // is: providers use the canonical `routerProviderRegistryHooks`
      // instances (re-exported through '@modern-js/runtime/context'). Surface
      // any hooks outside that set loudly instead of dropping them silently.
      reportUnsupportedProviderRegistryHooks(providerPlugin);

      providerPlugin.setup?.(api);
    },
  };
};

export default routerPlugin;
export type { RouterExtendsHooks } from './hooks';
export { modifyRoutes } from './plugin';
export {
  type RouterProviderFactory,
  type RouterProviderPlugin,
  registerRouterProvider,
  resolveRouterProvider,
} from './provider';
export { renderRoutes } from './utils';
export type { RouterConfig, SingleRouteConfig };
