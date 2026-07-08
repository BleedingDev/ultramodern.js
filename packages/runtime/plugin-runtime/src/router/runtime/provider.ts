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
import type { RuntimePlugin } from '../../common';
import type { RouterExtendsHooks } from './hooks';
import {
  modifyRoutes,
  onAfterCreateRouter,
  onAfterHydrateRouter,
  onBeforeCreateRouter,
  onBeforeCreateRoutes,
  onBeforeHydrateRouter,
} from './hooks';
import type { RouterConfig } from './types';

/**
 * The single declaration source for the router hook registry. Every router
 * provider (built-in react-router, @modern-js/plugin-tanstack, ...) and the
 * framework-resolving wrapper plugin register exactly these instances, so the
 * hook set is defined once and providers cannot drift apart.
 */
export const routerProviderRegistryHooks: RouterExtendsHooks = {
  modifyRoutes,
  onBeforeCreateRoutes,
  onBeforeCreateRouter,
  onAfterCreateRouter,
  onBeforeHydrateRouter,
  onAfterHydrateRouter,
};

export type RouterProviderPlugin = RuntimePlugin<{
  extendHooks: RouterExtendsHooks;
}>;

/**
 * Guard for the wrapper plugin (`router/internal`): a resolved provider is
 * only invoked through `setup`, so registry hooks outside the canonical
 * router hook contract cannot be registered for it. Returns the offending
 * hook names and warns once so they are surfaced instead of silently dropped.
 */
export function reportUnsupportedProviderRegistryHooks(providerPlugin: {
  name?: string;
  registryHooks?: Record<string, unknown>;
}): string[] {
  const unsupportedHookNames = Object.keys(
    providerPlugin.registryHooks ?? {},
  ).filter(hookName => !(hookName in routerProviderRegistryHooks));

  if (unsupportedHookNames.length > 0) {
    console.warn(
      `[@modern-js/runtime] The router provider "${providerPlugin.name}" declares registry hooks outside the router hook contract: ${unsupportedHookNames.join(
        ', ',
      )}. These hooks are not registered when the provider is resolved through \`runtime.router.framework\` — declare them on a separate runtime plugin instead.`,
    );
  }

  return unsupportedHookNames;
}

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

/**
 * Versioned registry key. The unsuffixed key
 * ('@modern-js/runtime:router-providers') is owned by older published copies
 * of this module whose `registerRouterProvider` *throws* on a same-name
 * re-registration. Sharing a registry object with such a copy (e.g. a Module
 * Federation remote bundling an old @modern-js/runtime) would crash the old
 * copy as soon as it sees a name taken by a different factory. The ':v2'
 * suffix isolates keep-first-generation copies in their own registry: old and
 * new copies each register and resolve against their own slot, and neither
 * side throws. Bump the suffix again if registration semantics ever change
 * incompatibly.
 */
const REGISTRY_SLOT: unique symbol = Symbol.for(
  '@modern-js/runtime:router-providers:v2',
);

function getRegistry(): RouterProviderRegistry {
  const host = globalThis as { [REGISTRY_SLOT]?: RouterProviderRegistry };
  host[REGISTRY_SLOT] ??= { providers: new Map(), warnedDuplicates: new Set() };
  // Defense in depth within the v2 key: if a future v2-keyed copy of this
  // module ever predates a later-added field (mixed v2 minors in a Module
  // Federation setup), heal the shape instead of crashing on `undefined`.
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
  options: {
    /**
     * The resolving module's own copy of a provider. The registry is
     * realm-global with keep-first semantics, so in a page hosting several
     * independent Modern.js apps (Module Federation app-level remotes) the
     * first-loaded copy of a provider would otherwise win for *every* app —
     * a foreign factory closes over the foreign app's global context (routes,
     * App, runtime hooks) and renders the wrong app inside the resolving one.
     * When the resolved name matches `localDefault.name`, the local factory
     * is returned instead of whatever copy registered first.
     */
    localDefault?: { name: string; factory: RouterProviderFactory };
  } = {},
): RouterProviderFactory {
  const registry = getRegistry();
  // `||` on purpose: a falsy framework value (empty string from env
  // templating, `false`, `undefined`) falls back to the default provider
  // instead of erroring on an unknown framework "". Prefer the resolving
  // module's local default before the realm-global registry default so
  // app-level remotes do not inherit host runtime provider closures.
  const name =
    framework || options.localDefault?.name || registry.defaultProvider;

  if (name === undefined) {
    throw new Error(
      '[@modern-js/runtime] No default router provider is registered. This is a bug in the runtime setup.',
    );
  }

  if (
    options.localDefault !== undefined &&
    name === options.localDefault.name
  ) {
    return options.localDefault.factory;
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
