import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { AppTools, CliPlugin } from '@modern-js/app-tools';
import type { Rspack } from '@rsbuild/core';

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

/**
 * Framework packages whose subpaths share module state: React contexts and
 * Effect's request storage. Every exported subpath under `prefix` is shared,
 * and each subpath reaches that state through a package self-reference (for
 * example `@modern-js/runtime/context`), so a remote never evaluates its own
 * copy. Subpaths are listed from the package's `exports` rather than shared by
 * prefix: the app aliases unexported ones such as `@modern-js/runtime/registry`
 * to its own generated modules, which must never be shared.
 * `contexts` matches the files that define that state (React contexts, the
 * Effect request storage): only a shared module or another of those files may
 * import them.
 */
const FRAMEWORK_SHARES = [
  {
    packageName: '@modern-js/runtime',
    prefix: '@modern-js/runtime/',
    contextsRequest: '@modern-js/runtime/context',
    contexts: /[\\/]core[\\/]context[\\/](?:index|runtime)\.[cm]?[jt]sx?$/,
  },
  {
    packageName: '@modern-js/plugin-i18n',
    prefix: '@modern-js/plugin-i18n/runtime/',
    contextsRequest: '@modern-js/plugin-i18n/runtime/contexts',
    contexts: /[\\/]runtime[\\/]contexts\.[cm]?[jt]sx?$/,
  },
  {
    packageName: '@modern-js/bff-effect',
    prefix: '@modern-js/bff-effect/',
    contextsRequest: '@modern-js/bff-effect/context',
    contexts: /[\\/]effect[\\/]context\.[cm]?[jt]sx?$/,
  },
] as const;

export type FrameworkSharedPackage = {
  prefix: string;
  version: string;
  /** Exported subpath requests under `prefix` that load code. */
  requests: string[];
  /** Real path of the installed package directory. */
  directory: string;
  contextsRequest?: string;
  contexts?: RegExp;
};

// A types-only export or a wildcard pattern names no module to share.
const loadsCode = (target: unknown): boolean =>
  typeof target === 'string'
    ? !target.endsWith('.d.ts')
    : Boolean(target) &&
      typeof target === 'object' &&
      Object.entries(target as object).some(
        ([condition, value]) => condition !== 'types' && loadsCode(value),
      );

const exportedRequests = (
  packageName: string,
  prefix: string,
  exports: unknown,
) =>
  Object.entries(
    exports && typeof exports === 'object' ? (exports as object) : {},
  )
    .filter(
      ([subpath, target]) =>
        subpath !== './package.json' &&
        !subpath.includes('*') &&
        loadsCode(target),
    )
    .map(([subpath]) => `${packageName}${subpath.slice(1)}`)
    .filter(request => request.startsWith(prefix))
    .sort();

/**
 * The app's `node_modules` lookup for `packageName`. `NODE_PATH` is ignored:
 * a package the app does not install is not the app's to share.
 */
const findInstalledManifest = (appDirectory: string, packageName: string) => {
  for (let directory = appDirectory; ; ) {
    const manifest = path.join(
      directory,
      'node_modules',
      packageName,
      'package.json',
    );
    if (existsSync(manifest)) return manifest;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
};

/** The framework packages the app installs, with their installed versions. */
export const resolveFrameworkSharedPackages = (
  appDirectory: string,
): FrameworkSharedPackage[] =>
  FRAMEWORK_SHARES.flatMap(share => {
    const manifest = findInstalledManifest(appDirectory, share.packageName);
    if (!manifest) return [];
    const { version, exports } = JSON.parse(readFileSync(manifest, 'utf8')) as {
      version: string;
      exports?: unknown;
    };
    return [
      {
        ...share,
        version,
        requests: exportedRequests(share.packageName, share.prefix, exports),
        directory: realpathSync(path.dirname(manifest)),
      },
    ];
  });

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

const toEntries = (shared: unknown) =>
  (Array.isArray(shared) ? shared : [shared]) as Array<string | SharedRecord>;

/** Add `missing` to `shared`, keeping every entry the app configured. */
const withShared = <T>(shared: T, missing: SharedRecord): T => {
  const entries = toEntries(shared);
  const added = Object.fromEntries(
    Object.entries(missing).filter(
      ([request]) => !findShared(entries, request),
    ),
  );
  if (Object.keys(added).length === 0) return shared;
  if (!shared) return added as T;
  return (
    Array.isArray(shared) ? [...shared, added] : { ...shared, ...added }
  ) as T;
};

/**
 * Share `react/jsx-runtime` and `react/jsx-dev-runtime` as singletons at the
 * shared `react` version whenever `react` itself is shared. Entries the app
 * configured explicitly are kept as written.
 */
export const withReactJsxRuntimeShared = <T>(shared: T): T => {
  if (!shared || typeof shared !== 'object') return shared;
  const react = findShared(toEntries(shared), 'react');
  if (!react) return shared;
  return withShared(
    shared,
    Object.fromEntries(
      REACT_JSX_RUNTIMES.map(request => [
        request,
        {
          ...(react.requiredVersion === undefined
            ? {}
            : { requiredVersion: react.requiredVersion }),
          singleton: true,
          treeShaking: false,
        },
      ]),
    ),
  );
};

/**
 * Share every exported subpath of the framework packages as a singleton at
 * the installed version. Entries the app configured explicitly are kept.
 */
export const withFrameworkShared = <T>(
  shared: T,
  packages: FrameworkSharedPackage[],
): T =>
  withShared(
    shared,
    Object.fromEntries(
      packages.flatMap(({ requests, version }) =>
        requests.map(request => [
          request,
          { requiredVersion: version, singleton: true, treeShaking: false },
        ]),
      ),
    ),
  );

type FederationPluginOptions = {
  shared?: Shared;
  exposes?: unknown;
  mfConfig?: unknown;
};

// `secondarySharedTreeShaking` wraps the federation config in `mfConfig`.
const federationConfig = (
  options: FederationPluginOptions,
): FederationPluginOptions =>
  options.mfConfig && typeof options.mfConfig === 'object'
    ? federationConfig(options.mfConfig as FederationPluginOptions)
    : options;

const withDefaults = (
  options: FederationPluginOptions,
  packages: FrameworkSharedPackage[],
): FederationPluginOptions =>
  options.mfConfig && typeof options.mfConfig === 'object'
    ? {
        ...options,
        mfConfig: withDefaults(
          options.mfConfig as FederationPluginOptions,
          packages,
        ),
      }
    : {
        ...options,
        shared: withFrameworkShared(
          withReactJsxRuntimeShared(options.shared),
          packages,
        ),
      };

const hasExposes = (options: FederationPluginOptions) => {
  const { exposes } = federationConfig(options);
  return Array.isArray(exposes)
    ? exposes.length > 0
    : Boolean(exposes) && Object.keys(exposes as object).length > 0;
};

const SHARED_MODULE_TYPES = new Set([
  'consume-shared-module',
  'provide-module',
]);

// Only normal modules carry a file resource.
const resourceOf = (module: Rspack.Module | null) =>
  module && 'resource' in module && typeof module.resource === 'string'
    ? module.resource
    : undefined;

const describeModule = (module: Rspack.Module | null) =>
  module ? (resourceOf(module) ?? module.identifier()) : 'an entry';

/**
 * Fails a federation build that exposes modules when a framework context file
 * is imported other than through its shared request. That remote would run
 * with its own contexts and never see the host's request state.
 */
export class FederationPrivateContextsPlugin {
  constructor(private readonly packages: FrameworkSharedPackage[]) {}

  apply(compiler: Rspack.Compiler) {
    const name = 'FederationPrivateContextsPlugin';
    const definitionOf = (module: Rspack.Module | null) => {
      const resource = resourceOf(module);
      return resource === undefined
        ? undefined
        : this.packages.find(
            ({ contexts, directory }) =>
              contexts?.test(resource) &&
              resource.startsWith(directory + path.sep),
          );
    };
    compiler.hooks.compilation.tap(name, compilation => {
      compilation.hooks.finishModules.tap(name, modules => {
        for (const module of modules) {
          const share = definitionOf(module);
          if (!share) continue;
          const importer = compilation.moduleGraph
            .getIncomingConnections(module)
            .map(connection => connection.originModule)
            .find(
              origin =>
                !(origin && SHARED_MODULE_TYPES.has(origin.type)) &&
                definitionOf(origin) !== share,
            );
          if (importer === undefined) continue;
          compilation.errors.push(
            new compiler.webpack.WebpackError(
              `[ultramodern] This Module Federation build bundles a private copy of ${share.contextsRequest}: ${describeModule(importer)} imports ${describeModule(module)} directly. It would not see the host's request state. Share the "${share.prefix}" subpaths and import the contexts through "${share.contextsRequest}".`,
            ),
          );
        }
      });
    });
  }
}

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
        const ids = MODULE_FEDERATION_CHAIN_IDS.filter(id =>
          chain.plugins.has(id),
        );
        if (ids.length === 0) return;
        const packages = resolveFrameworkSharedPackages(
          api.getAppContext().appDirectory,
        );
        let exposes = false;
        for (const id of ids) {
          const [options] = chain.plugin(id).get('args') as [
            FederationPluginOptions,
          ];
          exposes ||= hasExposes(options);
          chain
            .plugin(id)
            .tap(([options, ...rest]) => [
              withDefaults(options, packages),
              ...rest,
            ]);
        }
        if (exposes) {
          chain
            .plugin('ultramodern-federation-private-contexts')
            .use(FederationPrivateContextsPlugin, [packages]);
        }
      });
    },
  });
