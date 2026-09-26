import type { AppTools, CliPlugin } from '@modern-js/app-tools';

type SharedConfig = { requiredVersion?: unknown } & Record<string, unknown>;
type SharedRecord = Record<string, string | SharedConfig>;
type Shared = SharedRecord | Array<string | SharedRecord>;

// The compiled JSX in every federated bundle imports these React entries.
// Sharing `react` without them gives each bundle its own JSX runtime, so a
// remote's elements reach the host's React with a foreign runtime identity.
const REACT_JSX_RUNTIMES = ['react/jsx-runtime', 'react/jsx-dev-runtime'];

// Chain ids under which `@module-federation/modern-js-v3` registers its
// browser and server federation plugins.
const MODULE_FEDERATION_CHAIN_IDS = [
  'plugin-module-federation',
  'plugin-module-federation-server',
];

const findShared = (
  entries: Array<string | SharedRecord>,
  request: string,
): SharedConfig | undefined => {
  for (const entry of entries) {
    if (entry === request) return {};
    if (typeof entry === 'object' && Object.hasOwn(entry, request)) {
      const config = entry[request];
      return typeof config === 'string' ? { requiredVersion: config } : config;
    }
  }
  return undefined;
};

/**
 * Share `react/jsx-runtime` and `react/jsx-dev-runtime` as singletons at the
 * shared `react` version whenever `react` itself is shared. Entries the app
 * configured explicitly are kept as written.
 */
export const withReactJsxRuntimeShared = <T>(shared: T): T => {
  if (!shared || typeof shared !== 'object') return shared;
  const entries = (Array.isArray(shared) ? shared : [shared]) as Array<
    string | SharedRecord
  >;
  const react = findShared(entries, 'react');
  if (!react) return shared;
  const missing: SharedRecord = {};
  for (const request of REACT_JSX_RUNTIMES) {
    if (findShared(entries, request)) continue;
    missing[request] = {
      ...(react.requiredVersion === undefined
        ? {}
        : { requiredVersion: react.requiredVersion }),
      singleton: true,
      treeShaking: false,
    };
  }
  if (Object.keys(missing).length === 0) return shared;
  return (
    Array.isArray(shared) ? [...shared, missing] : { ...shared, ...missing }
  ) as T;
};

type FederationPluginOptions = { shared?: Shared; mfConfig?: unknown };

const withDefaults = (
  options: FederationPluginOptions,
): FederationPluginOptions =>
  // `secondarySharedTreeShaking` wraps the federation config in `mfConfig`.
  options.mfConfig && typeof options.mfConfig === 'object'
    ? {
        ...options,
        mfConfig: withDefaults(options.mfConfig as FederationPluginOptions),
      }
    : { ...options, shared: withReactJsxRuntimeShared(options.shared) };

/**
 * Apply UltraModern's Module Federation share defaults to the federation
 * plugins that `@module-federation/modern-js-v3` registered on the chain.
 */
export const ultramodernModuleFederationSharedPlugin =
  (): CliPlugin<AppTools> => ({
    name: '@modern-js/ultramodern-module-federation-shared',
    pre: [
      '@modern-js/plugin-module-federation',
      '@modern-js/plugin-module-federation-ssr',
    ],
    setup(api) {
      api.modifyBundlerChain(chain => {
        for (const id of MODULE_FEDERATION_CHAIN_IDS) {
          if (!chain.plugins.has(id)) continue;
          chain
            .plugin(id)
            .tap(([options, ...rest]) => [withDefaults(options), ...rest]);
        }
      });
    },
  });
