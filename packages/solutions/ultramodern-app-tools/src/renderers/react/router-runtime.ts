import {
  routerPlugin as nativeRouterPlugin,
  routerProviderRegistryHooks,
} from '@modern-js/runtime/router/internal';
import { createRouterPlugin } from '@modern-js/runtime-extensions/router-provider';

const createProvider = createRouterPlugin({
  defaultProvider: { name: 'react-router', factory: nativeRouterPlugin },
  registryHooks: routerProviderRegistryHooks,
});

export const routerPlugin: typeof nativeRouterPlugin = config =>
  createProvider(config);

export default routerPlugin;
