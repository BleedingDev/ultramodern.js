import type { RuntimePlugin } from '@modern-js/runtime';
import {
  type RouterExtendsHooks,
  routerProviderRegistryHooks,
} from '@modern-js/runtime/context';
import { createRouterStatePlugin } from '@modern-js/runtime-extensions/router-state-plugin';

/** Observe every app entry before its selected router prepares request state. */
export const routerStatePlugin = (): RuntimePlugin<{
  extendHooks: RouterExtendsHooks;
}> => ({
  ...createRouterStatePlugin({ registryHooks: routerProviderRegistryHooks }),
  post: ['@modern-js/plugin-router', '@modern-js/plugin-router-tanstack'],
});

export default routerStatePlugin;
