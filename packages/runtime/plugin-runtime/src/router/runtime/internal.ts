// @effect-diagnostics unnecessaryArrowBlock:off
import { merge } from '@modern-js/runtime-utils/merge';
import type { RuntimePlugin } from '../../common';
import type { RouterExtendsHooks } from './hooks';
import { routerPlugin as reactRouterPlugin } from './plugin';
import type { RouterProviderRegistration } from './provider';
import {
  createRouterProviderRealm,
  registerRouterProvider,
  reportUnsupportedProviderRegistryHooks,
  resolveRouterProvider,
  routerProviderRegistryHooks,
} from './provider';
import type { RouterConfig, SingleRouteConfig } from './types';

registerRouterProvider('react-router', reactRouterPlugin, { isDefault: true });

type LocalRouterProvider = Omit<RouterProviderRegistration, 'isDefault'>;

export type RouterPluginFactory = (
  userConfig?: Partial<RouterConfig>,
) => RuntimePlugin<{
  extendHooks: RouterExtendsHooks;
}>;

/**
 * Create one router wrapper and its provider realm for a runtime entry. Optional
 * providers are supplied by the entry-owning integration (for example the
 * TanStack runtime/router module), so independently bundled apps never resolve
 * factories from another app's module graph.
 */
export const createRouterPlugin = (
  localProviders: readonly LocalRouterProvider[] = [],
): RouterPluginFactory => {
  const providerRealm = createRouterProviderRealm([
    {
      name: 'react-router',
      factory: reactRouterPlugin,
      isDefault: true,
    },
    ...localProviders,
  ]);

  return (
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

        const pluginFactory = resolveRouterProvider(mergedConfig.framework, {
          realm: providerRealm,
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
};

export const routerPlugin = createRouterPlugin();

export default routerPlugin;
export type { RouterExtendsHooks } from './hooks';
export { modifyRoutes } from './plugin';
export {
  createRouterProviderRealm,
  type RouterProviderFactory,
  type RouterProviderPlugin,
  type RouterProviderRealm,
  type RouterProviderRegistration,
  registerRouterProvider,
  resolveRouterProvider,
} from './provider';
export { renderRoutes } from './utils';
export type { RouterConfig, SingleRouteConfig };
