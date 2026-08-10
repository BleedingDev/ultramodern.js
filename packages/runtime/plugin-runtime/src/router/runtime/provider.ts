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

export type RouterProviderRegistration = {
  name: string;
  factory: RouterProviderFactory;
  isDefault?: boolean;
};

/**
 * App-owned provider catalog. Provider factories close over their module graph,
 * so they must be resolved from the runtime wrapper that owns the app instead
 * of from a page-global first-registration winner.
 */
export type RouterProviderRealm = Readonly<{
  defaultProvider?: string;
  get: (name: string) => RouterProviderFactory | undefined;
  names: () => readonly string[];
}>;

export function createRouterProviderRealm(
  registrations: readonly RouterProviderRegistration[],
): RouterProviderRealm {
  const providers = new Map<string, RouterProviderFactory>();
  let defaultProvider: string | undefined;

  for (const registration of registrations) {
    if (registration.name.length === 0) {
      throw new Error(
        '[@modern-js/runtime] A router provider realm cannot contain an unnamed provider.',
      );
    }
    if (providers.has(registration.name)) {
      throw new Error(
        `[@modern-js/runtime] Router provider "${registration.name}" is declared more than once in the same runtime realm.`,
      );
    }
    if (
      registration.isDefault === true &&
      defaultProvider !== undefined &&
      defaultProvider !== registration.name
    ) {
      throw new Error(
        `[@modern-js/runtime] Router provider realm declares both "${defaultProvider}" and "${registration.name}" as defaults.`,
      );
    }

    providers.set(registration.name, registration.factory);
    if (registration.isDefault === true) {
      defaultProvider = registration.name;
    }
  }

  const providerNames = Object.freeze([...providers.keys()]);
  return Object.freeze({
    ...(defaultProvider !== undefined ? { defaultProvider } : {}),
    get: (name: string) => providers.get(name),
    names: () => providerNames,
  });
}

type RouterProviderRegistry = {
  providers: Map<string, RouterProviderFactory>;
  defaultProvider?: string;
  /** Names that were registered by more than one module instance. */
  duplicateProviders: Set<string>;
  /** Duplicate names already reported when the compatibility fallback won. */
  warnedDuplicates: Set<string>;
};

/**
 * Versioned compatibility-registry key. The unsuffixed key
 * ('@modern-js/runtime:router-providers') is owned by older published copies
 * of this module whose `registerRouterProvider` *throws* on a same-name
 * re-registration. `:v2` added keep-first registration but also enforced one
 * non-default provider across the whole JavaScript realm. `:v3` removes that
 * page-global app invariant: explicit runtime realms own provider selection,
 * while this registry remains only a mixed-version fallback. New copies read
 * but never mutate the v2 slot so older published copies remain compatible.
 */
const REGISTRY_SLOT: unique symbol = Symbol.for(
  '@modern-js/runtime:router-providers:v3',
);
const LEGACY_V2_REGISTRY_SLOT: unique symbol = Symbol.for(
  '@modern-js/runtime:router-providers:v2',
);

function getRegistry(): RouterProviderRegistry {
  const host = globalThis as { [REGISTRY_SLOT]?: RouterProviderRegistry };
  host[REGISTRY_SLOT] ??= {
    providers: new Map(),
    duplicateProviders: new Set(),
    warnedDuplicates: new Set(),
  };
  // Defense in depth within the v3 key: if a future v3-keyed copy of this
  // module ever predates a later-added field (mixed v3 minors in a Module
  // Federation setup), heal the shape instead of crashing on `undefined`.
  host[REGISTRY_SLOT].duplicateProviders ??= new Set();
  host[REGISTRY_SLOT].warnedDuplicates ??= new Set();
  return host[REGISTRY_SLOT];
}

function getLegacyV2Registry():
  | Pick<RouterProviderRegistry, 'providers' | 'defaultProvider'>
  | undefined {
  const host = globalThis as {
    [LEGACY_V2_REGISTRY_SLOT]?: Pick<
      RouterProviderRegistry,
      'providers' | 'defaultProvider'
    >;
  };
  return host[LEGACY_V2_REGISTRY_SLOT];
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
    // the app; the first registration remains available for compatibility.
    // Merely loading independent app-owned realms is valid, so defer the
    // warning until a caller actually consumes this ambiguous fallback.
    if (existing !== factory) {
      registry.duplicateProviders.add(name);
    }
    return;
  }

  if (options.isDefault === true) {
    registry.defaultProvider = name;
  }

  registry.providers.set(name, factory);
}

export function resolveRouterProvider(
  framework?: RouterConfig['framework'],
  options: {
    /**
     * Provider factories owned by the resolving app/runtime wrapper. A realm
     * is the exclusive provider source when supplied because its factories
     * close over the correct app module graph.
     */
    realm?: RouterProviderRealm;
    /**
     * Legacy single-provider override retained for published wrappers. New
     * integrations should pass an app-owned `realm`, which supports every
     * provider rather than only the default.
     */
    localDefault?: { name: string; factory: RouterProviderFactory };
  } = {},
): RouterProviderFactory {
  if (options.realm !== undefined) {
    const name = framework || options.realm.defaultProvider;
    const realmProviderNames = options.realm.names();

    if (name === undefined) {
      throw new Error(
        `[@modern-js/runtime] The app-owned router provider realm does not declare a default provider. Available realm providers: ${
          realmProviderNames.join(', ') || '(none)'
        }.`,
      );
    }

    const factory = options.realm.get(name);
    if (factory === undefined) {
      throw new Error(
        `[@modern-js/runtime] Router provider "${name}" is not registered in the app-owned router provider realm. ` +
          `Available realm providers: ${
            realmProviderNames.join(', ') || '(none)'
          }. Compatibility registry fallback is disabled for app-owned realms.`,
      );
    }

    return factory;
  }

  const registry = getRegistry();
  const legacyV2Registry = getLegacyV2Registry();
  // `||` on purpose: a falsy framework value (empty string from env
  // templating, `false`, `undefined`) falls back to the default provider
  // instead of erroring on an unknown framework "". Prefer the older
  // localDefault contract before compatibility slots.
  const name =
    framework ||
    options.localDefault?.name ||
    registry.defaultProvider ||
    legacyV2Registry?.defaultProvider;

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
    if (
      registry.duplicateProviders.has(name) &&
      !registry.warnedDuplicates.has(name)
    ) {
      registry.warnedDuplicates.add(name);
      console.warn(
        `[@modern-js/runtime] The router provider "${name}" was registered more than once with different module instances, and a router wrapper without an app-owned provider realm is resolving the mixed-version compatibility fallback. The fallback is keeping the first registration. ` +
          'Modern router wrappers isolate app-owned realms automatically. ' +
          'For an older wrapper, share the provider runtime between Module Federation host and remotes or upgrade every app to a realm-aware runtime.',
      );
    }
    return factory;
  }

  const legacyV2Factory = legacyV2Registry?.providers.get(name);
  if (legacyV2Factory !== undefined) {
    return legacyV2Factory;
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
        [
          ...new Set([
            ...registry.providers.keys(),
            ...(legacyV2Registry?.providers.keys() ?? []),
          ]),
        ].join(', ') || '(none)'
      }. Install and register the plugin that provides this router framework.`,
  );
}

/**
 * Test-only escape hatch: compatibility registries live on `globalThis`, so
 * unit tests need a way to restore a pristine state between cases.
 */
export function unsafe_resetRouterProvidersForTesting(): void {
  const host = globalThis as {
    [REGISTRY_SLOT]?: RouterProviderRegistry;
    [LEGACY_V2_REGISTRY_SLOT]?: unknown;
  };
  delete host[REGISTRY_SLOT];
  delete host[LEGACY_V2_REGISTRY_SLOT];
}
