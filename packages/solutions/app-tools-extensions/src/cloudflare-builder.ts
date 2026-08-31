import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { SERVICE_WORKER_ENVIRONMENT_NAME } from '@modern-js/builder';
import type { BffUserConfig } from '@modern-js/server-core';
import { isProd } from '@modern-js/utils';
import type {
  EnvironmentConfig,
  ModifyBundlerChainFn,
  RsbuildEntry,
  RsbuildEntryDescription,
} from '@rsbuild/core';
import { provider } from 'std-env';
import { CLOUDFLARE_WORKER_NODE_BUILTINS } from './cloudflare-output-contract';
import { getTemplatePath } from './read-template';

const moduleRequire = createRequire(import.meta.url);
const BFF_EFFECT_WORKER_ENTRY_NAME = '__modern_bff_effect';
const BFF_EFFECT_WORKER_RUNTIME_QUERY = 'modern-bff-runtime';
const MF_SSR_DATA_FETCH_RUNTIME_PLUGIN =
  '@module-federation/modern-js-v3/ssr-inject-data-fetch-function-plugin';
const MF_SSR_DEV_RUNTIME_PLUGIN =
  '@module-federation/modern-js-v3/ssr-dev-plugin';
const JS_OR_TS_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.mts',
  '.cjs',
  '.cts',
]);

export interface CloudflareBuilderNormalizedConfig {
  bff?: BffUserConfig;
  deploy?: { target?: string };
}

export interface CloudflareBuilderAppContext {
  apiDirectory: string;
  appDirectory: string;
}

export interface CloudflareBuilderEnvironmentsOptions {
  appContext: CloudflareBuilderAppContext;
  environments: Record<string, EnvironmentConfig>;
  normalizedConfig: CloudflareBuilderNormalizedConfig;
  resolveDeployProvider?: ResolveCloudflareDeployProvider;
}

export type ResolveCloudflareDeployProvider = () => string | undefined;

export interface CloudflareWorkerRspackConfig {
  externals: Record<string, string>;
  externalsType: 'module-import';
  module: {
    parser: {
      javascript: {
        dynamicImportMode: 'eager';
      };
    };
  };
  optimization: {
    runtimeChunk: { name: string };
    splitChunks: {
      chunks: 'all';
      minSize: 0;
      name: string;
    };
  };
}

export type CloudflareBuilderEnvironmentsResult = {
  environments: Record<string, EnvironmentConfig>;
};

export type ModifyCloudflareBuilderEnvironments = (
  input: CloudflareBuilderEnvironmentsResult,
) =>
  | CloudflareBuilderEnvironmentsResult
  | Promise<CloudflareBuilderEnvironmentsResult>;

export interface CloudflareBuilderPluginApi {
  getAppContext(): Readonly<CloudflareBuilderAppContext>;
  getNormalizedConfig(): Readonly<CloudflareBuilderNormalizedConfig>;
  modifyBuilderEnvironments(handler: ModifyCloudflareBuilderEnvironments): void;
}

export interface CloudflareBuilderPlugin {
  name: string;
  setup(api: CloudflareBuilderPluginApi): void;
}

const findExistingFile = (candidates: string[]) =>
  candidates.find(candidate => fs.existsSync(candidate));

const resolveJsOrTsEntry = (entryWithoutOrWithExtension: string) => {
  if (JS_OR_TS_EXTENSIONS.has(path.extname(entryWithoutOrWithExtension))) {
    return fs.existsSync(entryWithoutOrWithExtension)
      ? entryWithoutOrWithExtension
      : undefined;
  }

  return findExistingFile(
    [...JS_OR_TS_EXTENSIONS].map(
      extension => `${entryWithoutOrWithExtension}${extension}`,
    ),
  );
};

const resolvePackageEntry = (packageName: string, paths: string[]) => {
  try {
    return fs.realpathSync(moduleRequire.resolve(packageName, { paths }));
  } catch {
    return undefined;
  }
};

const findPackageRoot = (entryFile: string, packageName: string) => {
  let directory = path.dirname(entryFile);

  while (directory !== path.dirname(directory)) {
    const packageJsonPath = path.join(directory, 'package.json');

    try {
      const packageJson: unknown = JSON.parse(
        fs.readFileSync(packageJsonPath, 'utf-8'),
      );
      if (
        typeof packageJson === 'object' &&
        packageJson !== null &&
        'name' in packageJson &&
        packageJson.name === packageName
      ) {
        return directory;
      }
    } catch {}

    directory = path.dirname(directory);
  }

  return undefined;
};

const resolvePackageFile = (
  packageName: string,
  filePath: string,
  paths: string[],
) => {
  try {
    return fs.realpathSync(
      moduleRequire.resolve(`${packageName}/${filePath}`, { paths }),
    );
  } catch {
    try {
      const packageJsonPath = moduleRequire.resolve(
        `${packageName}/package.json`,
        { paths },
      );
      const packageFile = path.join(path.dirname(packageJsonPath), filePath);

      if (fs.existsSync(packageFile)) {
        return fs.realpathSync(packageFile);
      }
    } catch {}

    const packageEntry = resolvePackageEntry(packageName, paths);
    const packageRoot = packageEntry
      ? findPackageRoot(packageEntry, packageName)
      : undefined;
    const packageFile = packageRoot
      ? path.join(packageRoot, filePath)
      : undefined;

    return packageFile && fs.existsSync(packageFile)
      ? fs.realpathSync(packageFile)
      : undefined;
  }
};

const setAliasIfPresent = (
  alias: { set(name: string, value: string): unknown },
  name: string,
  value: string | undefined,
) => {
  if (value) {
    alias.set(name, value);
  }
};

const getCloudflareWorkerNodeExternals = () =>
  Object.fromEntries(
    CLOUDFLARE_WORKER_NODE_BUILTINS.flatMap(builtin => {
      const nodeBuiltin = `node:${builtin}`;
      return [
        [builtin, `module-import ${nodeBuiltin}`],
        [nodeBuiltin, `module-import ${nodeBuiltin}`],
      ];
    }),
  );

const normalizeWorkerOutputName = (name: string) =>
  path.posix.normalize(name.replace(/\\/gu, '/')).toLowerCase();

const reserveWorkerChunkName = (
  baseName: string,
  reservedOutputNames: ReadonlySet<string>,
) => {
  let name = baseName;
  while (reservedOutputNames.has(normalizeWorkerOutputName(name))) {
    name = `${name}_`;
  }
  return name;
};

export function getCloudflareWorkerRspackConfig(
  workerEntryNames: Iterable<string>,
): CloudflareWorkerRspackConfig {
  const entryNames = [...workerEntryNames];
  for (const entryName of entryNames) {
    const slashName = entryName.replace(/\\/gu, '/');
    const normalizedName = path.posix.normalize(slashName);
    if (
      entryName !== slashName ||
      normalizedName !== slashName ||
      normalizedName === '.' ||
      normalizedName.startsWith('../') ||
      path.posix.isAbsolute(normalizedName) ||
      path.win32.isAbsolute(slashName) ||
      /^[A-Za-z]:/u.test(slashName)
    ) {
      throw new Error(
        `Cloudflare worker entry name "${entryName}" must be a canonical relative output path without dot segments or backslashes.`,
      );
    }
  }

  const reservedNames = new Set(entryNames.map(normalizeWorkerOutputName));
  const runtimeName = reserveWorkerChunkName(
    '__modern_worker_runtime',
    reservedNames,
  );
  reservedNames.add(normalizeWorkerOutputName(runtimeName));
  const sharedName = reserveWorkerChunkName(
    '__modern_worker_shared',
    reservedNames,
  );

  return {
    externals: getCloudflareWorkerNodeExternals(),
    externalsType: 'module-import',
    module: {
      parser: {
        javascript: {
          dynamicImportMode: 'eager',
        },
      },
    },
    optimization: {
      runtimeChunk: { name: runtimeName },
      splitChunks: {
        chunks: 'all',
        minSize: 0,
        name: sharedName,
      },
    },
  };
}

export function applyCloudflareWorkerRspackConfig(
  chain: Parameters<ModifyBundlerChainFn>[0],
  workerEntryNames: Iterable<string>,
) {
  const config = getCloudflareWorkerRspackConfig(workerEntryNames);

  chain.externals(config.externals);
  chain.externalsType(config.externalsType);
  chain.module.parser.merge(config.module.parser);
  chain.optimization.runtimeChunk(config.optimization.runtimeChunk);
  chain.optimization.splitChunks(config.optimization.splitChunks);
}

export function applyCloudflareWorkerMfRuntimeBoundary(
  chain: Parameters<ModifyBundlerChainFn>[0],
) {
  const runtimePlugin = getTemplatePath(
    'cloudflare-worker-mf-ssr-runtime-plugin.mjs',
  );
  chain.plugins.delete('plugin-module-federation');
  chain.resolve.alias.set(
    `${MF_SSR_DATA_FETCH_RUNTIME_PLUGIN}$`,
    runtimePlugin,
  );
  chain.resolve.alias.set(`${MF_SSR_DEV_RUNTIME_PLUGIN}$`, runtimePlugin);
}

const getEffectBffEntry = (
  normalizedConfig: CloudflareBuilderNormalizedConfig,
  appContext: CloudflareBuilderAppContext,
) => {
  if (
    !normalizedConfig.bff ||
    normalizedConfig.bff.runtimeFramework === 'hono'
  ) {
    return undefined;
  }

  const configuredEntry = normalizedConfig.bff.effect?.entry;
  if (configuredEntry) {
    const entryWithoutOrWithExtension = path.isAbsolute(configuredEntry)
      ? configuredEntry
      : path.resolve(appContext.appDirectory, configuredEntry);
    return resolveJsOrTsEntry(entryWithoutOrWithExtension);
  }

  return resolveJsOrTsEntry(path.resolve(appContext.apiDirectory, 'index'));
};

const CLOUDFLARE_DEPLOY_PROVIDERS = new Set([
  'cloudflare',
  'cloudflare_pages',
  'cloudflare_workers',
]);

const resolveStdEnvDeployProvider: ResolveCloudflareDeployProvider = () =>
  provider;

const isCloudflareWorkerDeploy = (
  normalizedConfig: CloudflareBuilderNormalizedConfig,
  resolveDeployProvider: ResolveCloudflareDeployProvider,
) => {
  const explicitTarget =
    normalizedConfig.deploy?.target || process.env.MODERNJS_DEPLOY;
  if (explicitTarget) {
    return explicitTarget === 'cloudflare';
  }

  const detectedProvider = resolveDeployProvider();
  return detectedProvider
    ? CLOUDFLARE_DEPLOY_PROVIDERS.has(detectedProvider)
    : false;
};

const rewriteWorkerEntryPath = (entry: string) =>
  entry
    .replace('index.jsx', 'index.server.jsx')
    .replace('bootstrap.server.jsx', 'index.server.jsx')
    .replace('bootstrap.jsx', 'index.server.jsx');

const rewriteWorkerEntryDescription = (
  description: RsbuildEntryDescription,
): RsbuildEntryDescription => {
  const entryImport = description.import;
  if (typeof entryImport === 'string') {
    return { ...description, import: rewriteWorkerEntryPath(entryImport) };
  }
  if (Array.isArray(entryImport)) {
    return {
      ...description,
      import: entryImport.map(rewriteWorkerEntryPath),
    };
  }
  return description;
};

const rewriteWorkerEntries = (entries: RsbuildEntry): RsbuildEntry =>
  Object.fromEntries(
    Object.entries(entries).map(([name, value]) => {
      if (typeof value === 'string') {
        return [name, rewriteWorkerEntryPath(value)];
      }
      if (Array.isArray(value)) {
        return [name, value.map(rewriteWorkerEntryPath)];
      }
      return [name, rewriteWorkerEntryDescription(value)];
    }),
  );

const prependBundlerChain = (
  environment: EnvironmentConfig,
  handler: ModifyBundlerChainFn,
): EnvironmentConfig => {
  const bundlerChain = environment.tools?.bundlerChain;
  return {
    ...environment,
    tools: {
      ...environment.tools,
      htmlPlugin: false,
      bundlerChain: bundlerChain
        ? Array.isArray(bundlerChain)
          ? [handler, ...bundlerChain]
          : [handler, bundlerChain]
        : handler,
    },
  };
};

const getWorkerEntries = (
  environment: EnvironmentConfig,
  normalizedConfig: CloudflareBuilderNormalizedConfig,
  appContext: CloudflareBuilderAppContext,
) => {
  const configuredEntries = environment.source?.entry;
  if (!configuredEntries) {
    return undefined;
  }

  const entries = rewriteWorkerEntries(configuredEntries);
  const effectApiEntry = getEffectBffEntry(normalizedConfig, appContext);
  return effectApiEntry
    ? {
        ...entries,
        [BFF_EFFECT_WORKER_ENTRY_NAME]: [
          `${effectApiEntry}?${BFF_EFFECT_WORKER_RUNTIME_QUERY}`,
        ],
      }
    : entries;
};

const createCloudflareBundlerChain = (
  appContext: CloudflareBuilderAppContext,
  workerEntryNames: Iterable<string>,
): ModifyBundlerChainFn => {
  const resolvePaths = [appContext.appDirectory, process.cwd()];
  const tanstackRouterSsrServerFile = resolvePackageFile(
    '@tanstack/router-core',
    'dist/esm/ssr/ssr-server.js',
    resolvePaths,
  );
  const runtimeRscWorkerFile = resolvePackageFile(
    '@modern-js/runtime',
    'dist/esm/rsc/server.worker.mjs',
    resolvePaths,
  );
  const renderRscWorkerFile = resolvePackageFile(
    '@modern-js/render',
    'dist/esm/rscWorker.mjs',
    resolvePaths,
  );
  const reactFile = resolvePackageFile('react', 'index.js', resolvePaths);
  const reactJsxRuntimeFile = resolvePackageFile(
    'react',
    'jsx-runtime.js',
    resolvePaths,
  );
  const reactJsxDevRuntimeFile = resolvePackageFile(
    'react',
    'jsx-dev-runtime.js',
    resolvePaths,
  );
  const reactDomFile = resolvePackageFile(
    'react-dom',
    'index.js',
    resolvePaths,
  );
  const reactDomServerEdgeFile = resolvePackageFile(
    'react-dom',
    'server.edge.js',
    resolvePaths,
  );
  const loadableComponentFile = resolvePackageFile(
    '@loadable/component',
    'dist/esm/loadable.esm.mjs',
    [...resolvePaths, getTemplatePath('')],
  );
  const loadableServerWorkerFile = getTemplatePath(
    'cloudflare-worker-loadable-server.mjs',
  );
  const fsPromisesWorkerFile = getTemplatePath(
    'cloudflare-worker-fs-promises.mjs',
  );
  const pathWorkerFile = getTemplatePath('cloudflare-worker-path.mjs');
  const entryNames = [...workerEntryNames];

  return chain => {
    applyCloudflareWorkerRspackConfig(chain, entryNames);
    chain.output
      .module(true)
      .library({ type: 'module' })
      .publicPath('/')
      .chunkFormat('module')
      .chunkLoading('import')
      .workerChunkLoading('import');

    for (const condition of [
      'workerd',
      'worker',
      'webpack',
      isProd() ? 'production' : 'development',
      'import',
      'require',
      'module',
    ]) {
      chain.resolve.conditionNames.add(condition);
    }

    applyCloudflareWorkerMfRuntimeBoundary(chain);
    if (tanstackRouterSsrServerFile) {
      chain.resolve.alias.set(
        '@tanstack/router-core/ssr/server$',
        tanstackRouterSsrServerFile,
      );
      chain.resolve.alias.set(
        '@tanstack/router-core/ssr/server',
        tanstackRouterSsrServerFile,
      );
    }
    if (runtimeRscWorkerFile) {
      chain.resolve.alias.set(
        '@modern-js/runtime/rsc/server$',
        runtimeRscWorkerFile,
      );
      chain.resolve.alias.set(
        '@modern-js/runtime/rsc/server',
        runtimeRscWorkerFile,
      );
    }
    if (renderRscWorkerFile) {
      chain.resolve.alias.set('@modern-js/render/rsc$', renderRscWorkerFile);
      chain.resolve.alias.set('@modern-js/render/rsc', renderRscWorkerFile);
      chain.resolve.alias.set(
        '@modern-js/render/rsc-worker$',
        renderRscWorkerFile,
      );
    }
    setAliasIfPresent(chain.resolve.alias, 'react$', reactFile);
    setAliasIfPresent(
      chain.resolve.alias,
      'react/jsx-runtime$',
      reactJsxRuntimeFile,
    );
    setAliasIfPresent(
      chain.resolve.alias,
      'react/jsx-dev-runtime$',
      reactJsxDevRuntimeFile,
    );
    setAliasIfPresent(chain.resolve.alias, 'react-dom$', reactDomFile);
    setAliasIfPresent(
      chain.resolve.alias,
      'react-dom/server.edge$',
      reactDomServerEdgeFile,
    );
    setAliasIfPresent(
      chain.resolve.alias,
      '@loadable/component$',
      loadableComponentFile,
    );
    setAliasIfPresent(
      chain.resolve.alias,
      '@loadable/server$',
      loadableServerWorkerFile,
    );
    setAliasIfPresent(
      chain.resolve.alias,
      'fs/promises$',
      fsPromisesWorkerFile,
    );
    setAliasIfPresent(
      chain.resolve.alias,
      'node:fs/promises$',
      fsPromisesWorkerFile,
    );
    setAliasIfPresent(chain.resolve.alias, 'path$', pathWorkerFile);
    setAliasIfPresent(chain.resolve.alias, 'node:path$', pathWorkerFile);
    chain.resolve.alias.set(
      'react-server-dom-rspack/server.node$',
      'react-server-dom-rspack/server.edge',
    );
    chain.resolve.alias.set(
      'react-server-dom-rspack/server.node',
      'react-server-dom-rspack/server.edge',
    );
    chain.resolve.alias.set(
      'react-server-dom-rspack/client.node$',
      'react-server-dom-rspack/client.edge',
    );
    chain.resolve.alias.set(
      'react-server-dom-rspack/client.node',
      'react-server-dom-rspack/client.edge',
    );
    chain.resolve.fallback.set('fs', false);
    chain.resolve.fallback.set('node:fs', false);
  };
};

export function getCloudflareBuilderEnvironments({
  appContext,
  environments,
  normalizedConfig,
  resolveDeployProvider = resolveStdEnvDeployProvider,
}: CloudflareBuilderEnvironmentsOptions): Record<string, EnvironmentConfig> {
  if (!isCloudflareWorkerDeploy(normalizedConfig, resolveDeployProvider)) {
    return environments;
  }

  const workerEnvironment = environments[SERVICE_WORKER_ENVIRONMENT_NAME];
  if (!workerEnvironment) {
    return environments;
  }

  const workerEntries = getWorkerEntries(
    workerEnvironment,
    normalizedConfig,
    appContext,
  );
  if (!workerEntries) {
    return environments;
  }

  const cloudflareWorkerEnvironment = prependBundlerChain(
    {
      ...workerEnvironment,
      output: {
        ...workerEnvironment.output,
        module: true,
        target: 'web',
      },
      source: {
        ...workerEnvironment.source,
        entry: workerEntries,
      },
    },
    createCloudflareBundlerChain(appContext, Object.keys(workerEntries)),
  );

  return {
    ...environments,
    [SERVICE_WORKER_ENVIRONMENT_NAME]: cloudflareWorkerEnvironment,
  };
}

export function applyCloudflareBuilderEnvironments(
  options: CloudflareBuilderEnvironmentsOptions,
): CloudflareBuilderEnvironmentsResult {
  return { environments: getCloudflareBuilderEnvironments(options) };
}

export const createCloudflareBuilderPlugin = (
  resolveDeployProvider = resolveStdEnvDeployProvider,
): CloudflareBuilderPlugin => ({
  name: '@modern-js/cloudflare-builder',
  setup(api) {
    api.modifyBuilderEnvironments(({ environments }) =>
      applyCloudflareBuilderEnvironments({
        appContext: api.getAppContext(),
        environments,
        normalizedConfig: api.getNormalizedConfig(),
        resolveDeployProvider,
      }),
    );
  },
});
