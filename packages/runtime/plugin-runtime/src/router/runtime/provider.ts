/**
 * Fork-owned router-provider registry.
 *
 * `runtime.router.framework` selects the router implementation used by the
 * built-in router runtime plugin (`@modern-js/runtime/router/internal`).
 * Instead of hardcoding every implementation there, providers register
 * themselves here:
 *
 * - `react-router` registers itself as the default provider when the
 *   built-in router plugin module is loaded.
 * - `@modern-js/plugin-tanstack` registers the `tanstack` provider when its
 *   runtime entry is imported.
 */
import type { RuntimePlugin } from '../../core';
import type { RouterExtendsHooks } from './hooks';
import type { RouterConfig } from './types';

export type RouterProviderPlugin = RuntimePlugin<{
  extendHooks: RouterExtendsHooks;
}>;

export type RouterProviderFactory = (
  userConfig: Partial<RouterConfig>,
) => RouterProviderPlugin;

type RouterProviderRegistry = {
  providers: Map<string, RouterProviderFactory>;
  defaultProvider?: string;
  nonDefaultProvider?: string;
};

const REGISTRY_SLOT: unique symbol = Symbol.for(
  '@modern-js/runtime:router-providers',
);

function getRegistry(): RouterProviderRegistry {
  const host = globalThis as { [REGISTRY_SLOT]?: RouterProviderRegistry };
  host[REGISTRY_SLOT] ??= { providers: new Map() };
  return host[REGISTRY_SLOT];
}

export function registerRouterProvider(
  name: string,
  factory: RouterProviderFactory,
  options: { isDefault?: boolean } = {},
): void {
  const registry = getRegistry();
  const existing = registry.providers.get(name);

  if (existing && existing !== factory) {
    throw new Error(
      `[@modern-js/runtime] A router provider named "${name}" is already registered with a different implementation. ` +
        'Each router framework may only be provided by a single plugin — remove the duplicate router plugin from your setup.',
    );
  }

  if (!options.isDefault) {
    if (
      registry.nonDefaultProvider !== undefined &&
      registry.nonDefaultProvider !== name
    ) {
      throw new Error(
        `[@modern-js/runtime] Cannot register router provider "${name}": the competing router provider "${registry.nonDefaultProvider}" is already registered. ` +
          'Only one non-default router provider may be installed at a time — remove one of the router plugins.',
      );
    }
    registry.nonDefaultProvider = name;
  } else {
    registry.defaultProvider = name;
  }

  registry.providers.set(name, factory);
}

export function resolveRouterProvider(
  framework?: RouterConfig['framework'],
): RouterProviderFactory {
  const registry = getRegistry();
  const name = framework ?? registry.defaultProvider;

  if (name === undefined) {
    throw new Error(
      '[@modern-js/runtime] No default router provider is registered. This is a bug in the runtime setup.',
    );
  }

  const factory = registry.providers.get(name);
  if (factory) {
    return factory;
  }

  if (name === 'tanstack') {
    throw new Error(
      '[@modern-js/runtime] `runtime.router.framework` is set to "tanstack", but no TanStack router provider is registered. ' +
        'Install @modern-js/plugin-tanstack, add `tanstackRouterPlugin()` to the `plugins` array in modern.config.ts, ' +
        "and make sure '@modern-js/plugin-tanstack/runtime' is imported (e.g. in modern.runtime.ts).",
    );
  }

  throw new Error(
    `[@modern-js/runtime] Unknown router framework "${name}". ` +
      `Registered providers: ${
        [...registry.providers.keys()].join(', ') || '(none)'
      }. Install and register the plugin that provides this router framework.`,
  );
}

/**
 * Test-only escape hatch: the registry lives on `globalThis`, so unit tests
 * need a way to restore a pristine state between cases.
 */
export function unsafe_resetRouterProvidersForTesting(): void {
  const host = globalThis as { [REGISTRY_SLOT]?: RouterProviderRegistry };
  delete host[REGISTRY_SLOT];
}
