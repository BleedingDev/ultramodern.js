// @effect-diagnostics unnecessaryArrowBlock:off
import { merge } from '@modern-js/runtime-utils/merge';
import type { RuntimePlugin } from '../../core';
import type { RouterExtendsHooks } from './hooks';
import {
  modifyRoutes as modifyRoutesHook,
  onAfterCreateRouter as onAfterCreateRouterHook,
  onAfterHydrateRouter as onAfterHydrateRouterHook,
  onBeforeCreateRouter as onBeforeCreateRouterHook,
  onBeforeCreateRoutes as onBeforeCreateRoutesHook,
  onBeforeHydrateRouter as onBeforeHydrateRouterHook,
} from './hooks';
import { routerPlugin as reactRouterPlugin } from './plugin';
import { registerRouterProvider, resolveRouterProvider } from './provider';
import type { RouterConfig, SingleRouteConfig } from './types';

registerRouterProvider('react-router', reactRouterPlugin, { isDefault: true });

export const routerPlugin = (
  userConfig: Partial<RouterConfig> = {},
): RuntimePlugin<{
  extendHooks: RouterExtendsHooks;
}> => {
  return {
    name: '@modern-js/plugin-router',
    registryHooks: {
      onAfterCreateRouter: onAfterCreateRouterHook,
      onAfterHydrateRouter: onAfterHydrateRouterHook,
      onBeforeCreateRouter: onBeforeCreateRouterHook,
      modifyRoutes: modifyRoutesHook,
      onBeforeCreateRoutes: onBeforeCreateRoutesHook,
      onBeforeHydrateRouter: onBeforeHydrateRouterHook,
    },
    setup: api => {
      const mergedConfig = merge(
        api.getRuntimeConfig().router || {},
        userConfig,
      ) as RouterConfig;

      const pluginFactory = resolveRouterProvider(mergedConfig.framework);

      pluginFactory(userConfig).setup?.(api);
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
