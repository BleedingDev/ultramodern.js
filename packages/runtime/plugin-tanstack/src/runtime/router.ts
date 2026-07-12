/**
 * Entry-injected router module for entrypoints that are NOT TanStack
 * file-route entrypoints (e.g. apps configuring
 * `router: { framework: 'tanstack', createRoutes }` in modern.runtime.ts).
 *
 * The CLI plugin injects `{ name: 'router', path: '<pkg>/runtime/router' }`
 * for those entries. This module creates a framework-resolving wrapper whose
 * app-owned provider realm contains this module graph's TanStack factory.
 */
import * as runtimeRouter from '@modern-js/runtime/router/internal';
import { tanstackRouterProviderFactory } from './register';

type LegacyRouterPlugin = (typeof runtimeRouter)['routerPlugin'];
type CurrentRouterPluginCreator = (
  localProviders: readonly {
    name: string;
    factory: typeof tanstackRouterProviderFactory;
  }[],
) => LegacyRouterPlugin;

function getRouterPlugin(): LegacyRouterPlugin {
  const createRouterPlugin = Reflect.get(runtimeRouter, 'createRouterPlugin') as
    | CurrentRouterPluginCreator
    | undefined;

  if (typeof createRouterPlugin === 'function') {
    return createRouterPlugin([
      { name: 'tanstack', factory: tanstackRouterProviderFactory },
    ]);
  }

  const legacyRouterPlugin = Reflect.get(runtimeRouter, 'routerPlugin');

  if (typeof legacyRouterPlugin === 'function') {
    return tanstackRouterProviderFactory as unknown as LegacyRouterPlugin;
  }

  throw new Error(
    '[@modern-js/plugin-tanstack] The installed @modern-js/runtime/router/internal exports neither createRouterPlugin nor routerPlugin. Install a compatible @modern-js/runtime version.',
  );
}

export const routerPlugin: LegacyRouterPlugin = getRouterPlugin();
