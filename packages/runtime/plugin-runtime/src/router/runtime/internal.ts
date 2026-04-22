import { merge } from '@modern-js/runtime-utils/merge';
import type { RuntimePlugin } from '../../core';
import {
  onAfterCreateRouter as onAfterCreateRouterHook,
  onAfterHydrateRouter as onAfterHydrateRouterHook,
  onBeforeCreateRouter as onBeforeCreateRouterHook,
  modifyRoutes as modifyRoutesHook,
  onBeforeCreateRoutes as onBeforeCreateRoutesHook,
  onBeforeHydrateRouter as onBeforeHydrateRouterHook,
} from './hooks';
import type { RouterExtendsHooks } from './hooks';
import { routerPlugin as reactRouterPlugin } from './plugin';
import { tanstackRouterPlugin } from './tanstack/plugin';
import type { RouterConfig, SingleRouteConfig } from './types';

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

      const framework = mergedConfig.framework || 'react-router';
      const pluginFactory =
        framework === 'tanstack' ? tanstackRouterPlugin : reactRouterPlugin;

      pluginFactory(userConfig as any).setup?.(api as any);
    },
  };
};

export default routerPlugin;
export type { SingleRouteConfig, RouterConfig };
export type { RouterExtendsHooks } from './hooks';
export { renderRoutes } from './utils';
export { modifyRoutes } from './plugin';
