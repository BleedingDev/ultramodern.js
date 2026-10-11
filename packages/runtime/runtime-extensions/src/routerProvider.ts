// @effect-diagnostics globalConsole:off
import { merge } from '@modern-js/runtime-utils/merge';

/** Structural plugin contract; the composing integration supplies native hooks. */
export type RouterProviderPlugin = {
  name?: string;
  registryHooks?: Record<string, unknown>;
  setup?: (api: any) => unknown;
  [key: string]: unknown;
};

/**
 * Guard for the wrapper plugin (`router/internal`): a resolved provider is
 * only invoked through `setup`, so registry hooks outside the canonical
 * router hook contract cannot be registered for it. Returns the offending
 * hook names and warns once so they are surfaced instead of silently dropped.
 */
export function reportUnsupportedProviderRegistryHooks(
  providerPlugin: {
    name?: string;
    registryHooks?: Record<string, unknown>;
  },
  routerProviderRegistryHooks: Record<string, unknown>,
): string[] {
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

export type RouterProviderFactory = (userConfig?: any) => RouterProviderPlugin;

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

export function resolveRouterProvider(
  framework: string | undefined,
  options: { realm: RouterProviderRealm },
): RouterProviderFactory {
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
        }.`,
    );
  }

  return factory;
}

/** Compose app-owned providers without importing the native runtime graph. */
export function createRouterPlugin<Hooks extends Record<string, unknown>>({
  defaultProvider,
  registryHooks,
  localProviders = [],
}: {
  defaultProvider: { name: string; factory: RouterProviderFactory };
  registryHooks: Hooks;
  localProviders?: readonly Omit<RouterProviderRegistration, 'isDefault'>[];
}) {
  const realm = createRouterProviderRealm([
    { ...defaultProvider, isDefault: true },
    ...localProviders,
  ]);

  return (userConfig: Record<string, any> = {}) => ({
    name: '@modern-js/plugin-router',
    registryHooks,
    setup(api: {
      getRuntimeConfig: () => Record<string, unknown>;
      [key: string]: any;
    }) {
      const mergedConfig = merge(
        api.getRuntimeConfig().router || {},
        userConfig,
      );
      const factory = resolveRouterProvider(mergedConfig.framework, { realm });
      const provider = factory(userConfig);
      reportUnsupportedProviderRegistryHooks(provider, registryHooks);
      provider.setup?.(api);
    },
  });
}
