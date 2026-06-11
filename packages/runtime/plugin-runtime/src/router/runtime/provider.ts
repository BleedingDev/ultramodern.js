// @effect-diagnostics globalConsole:off
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
  /** Names that already produced a duplicate-registration warning. */
  warnedDuplicates: Set<string>;
};

const REGISTRY_SLOT: unique symbol = Symbol.for(
  '@modern-js/runtime:router-providers',
);

function getRegistry(): RouterProviderRegistry {
  const host = globalThis as { [REGISTRY_SLOT]?: RouterProviderRegistry };
  host[REGISTRY_SLOT] ??= { providers: new Map(), warnedDuplicates: new Set() };
  // The registry may have been created by an older copy of this module that
  // predates the `warnedDuplicates` field (e.g. mixed versions in a Module
  // Federation setup), so heal the shape defensively.
  host[REGISTRY_SLOT].warnedDuplicates ??= new Set();
  return host[REGISTRY_SLOT];
}

export function registerRouterProvider(
  name: string,
  factory: RouterProviderFactory,
  options: { isDefault?: boolean } = {},
): void {
  const registry = getRegistry();
  const existing = registry.providers.get(name);

  if (existing !== undefined) {
    // Keep-first semantics. A same-name re-registration with a *different*
    // factory is almost always two bundled copies of the same provider
    // module — e.g. a Module Federation remote that does not share
    // '@modern-js/plugin-tanstack/runtime' evaluates its own copy, which
    // creates a fresh factory function per evaluation. That must not crash
    // the app; the first registration wins and we warn once per name.
    if (existing !== factory && !registry.warnedDuplicates.has(name)) {
      registry.warnedDuplicates.add(name);
      console.warn(
        `[@modern-js/runtime] The router provider "${name}" was registered more than once with different module instances; keeping the first registration. ` +
          'This usually means two copies of the providing plugin were bundled — for Module Federation, add the provider runtime ' +
          "(e.g. '@modern-js/plugin-tanstack/runtime') to the shared modules of both the host and the remote to deduplicate it.",
      );
    }
    return;
  }

  if (options.isDefault !== true) {
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
  // `||` on purpose: a falsy framework value (empty string from env
  // templating, `false`, `undefined`) falls back to the default provider
  // instead of erroring on an unknown framework "".
  const name = framework || registry.defaultProvider;

  if (name === undefined) {
    throw new Error(
      '[@modern-js/runtime] No default router provider is registered. This is a bug in the runtime setup.',
    );
  }

  const factory = registry.providers.get(name);
  if (factory !== undefined) {
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
