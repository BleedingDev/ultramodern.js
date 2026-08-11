import fs from 'node:fs';
import path from 'node:path';
import { SERVICE_WORKER_ENVIRONMENT_NAME } from '@modern-js/builder';
import {
  isProd,
  isServiceWorker,
  isSSR,
  isUseRsc,
  isUseSSRBundle,
} from '@modern-js/utils';
import type { ModifyBundlerChainFn, RsbuildConfig } from '@rsbuild/core';
import { CLOUDFLARE_WORKER_NODE_BUILTINS } from '../../plugins/deploy/platforms/cloudflare-output-contract';
import type { AppNormalizedConfig } from '../../types';
import type { AppToolsContext } from '../../types/plugin';

const BFF_EFFECT_WORKER_ENTRY_NAME = '__modern_bff_effect';
const BFF_EFFECT_WORKER_RUNTIME_QUERY = 'modern-bff-runtime';
const MF_SSR_DATA_FETCH_RUNTIME_PLUGIN =
  '@module-federation/modern-js-v3/ssr-inject-data-fetch-function-plugin';
const MF_SSR_DEV_RUNTIME_PLUGIN =
  '@module-federation/modern-js-v3/ssr-dev-plugin';
const JS_OR_TS_EXTS = [
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.mts',
  '.cjs',
  '.cts',
] as const;
type JsOrTsExtension = (typeof JS_OR_TS_EXTS)[number];
const CLOUDFLARE_WORKER_COMPAT_TEMPLATE_DIR = path.resolve(
  __dirname,
  '../../plugins/deploy/platforms/templates',
);

function findExistingFile(candidates: string[]) {
  return candidates.find(candidate => fs.existsSync(candidate));
}

function resolveJsOrTsEntry(entryWithoutOrWithExt: string) {
  const extension = path.extname(entryWithoutOrWithExt) as JsOrTsExtension;
  if (JS_OR_TS_EXTS.includes(extension)) {
    return fs.existsSync(entryWithoutOrWithExt)
      ? entryWithoutOrWithExt
      : undefined;
  }

  return findExistingFile(
    JS_OR_TS_EXTS.map(extension => `${entryWithoutOrWithExt}${extension}`),
  );
}

function resolvePackageEntry(packageName: string, paths: string[]) {
  try {
    return fs.realpathSync(require.resolve(packageName, { paths }));
  } catch {
    return undefined;
  }
}

function resolvePackageFile(
  packageName: string,
  filePath: string,
  paths: string[],
) {
  try {
    return fs.realpathSync(
      require.resolve(`${packageName}/${filePath}`, {
        paths,
      }),
    );
  } catch {
    try {
      const packageJsonPath = require.resolve(`${packageName}/package.json`, {
        paths,
      });
      const packageFile = path.join(path.dirname(packageJsonPath), filePath);

      if (fs.existsSync(packageFile)) {
        return fs.realpathSync(packageFile);
      }
    } catch {}

    const packageEntry = resolvePackageEntry(packageName, paths);
    if (!packageEntry) {
      return undefined;
    }

    const packageRoot = findPackageRoot(packageEntry, packageName);
    const packageFile = packageRoot
      ? path.join(packageRoot, filePath)
      : undefined;

    return packageFile && fs.existsSync(packageFile)
      ? fs.realpathSync(packageFile)
      : undefined;
  }
}

function findPackageRoot(entryFile: string, packageName: string) {
  let directory = path.dirname(entryFile);

  while (directory !== path.dirname(directory)) {
    const packageJsonPath = path.join(directory, 'package.json');

    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      if (packageJson.name === packageName) {
        return directory;
      }
    } catch {}

    directory = path.dirname(directory);
  }

  return undefined;
}

function setAliasIfPresent(
  alias: { set: (name: string, value: string) => unknown },
  name: string,
  value: string | undefined,
) {
  if (value) {
    alias.set(name, value);
  }
}

function getCloudflareWorkerCompatFile(file: string) {
  return path.join(CLOUDFLARE_WORKER_COMPAT_TEMPLATE_DIR, file);
}

function getCloudflareWorkerNodeExternals() {
  return Object.fromEntries(
    CLOUDFLARE_WORKER_NODE_BUILTINS.flatMap(builtin => {
      const nodeBuiltin = `node:${builtin}`;

      return [
        [builtin, `module-import ${nodeBuiltin}`],
        [nodeBuiltin, `module-import ${nodeBuiltin}`],
      ];
    }),
  );
}

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

const normalizeWorkerOutputName = (name: string) =>
  path.posix.normalize(name.replace(/\\/gu, '/')).toLowerCase();

export function getCloudflareWorkerRspackConfig(
  workerEntryNames: Iterable<string>,
) {
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
    experiments: {
      outputModule: true,
    },
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
  } as const;
}

export function applyCloudflareWorkerRspackConfig(
  chain: Parameters<ModifyBundlerChainFn>[0],
  workerEntryNames: Iterable<string>,
) {
  const config = getCloudflareWorkerRspackConfig(workerEntryNames);

  // webpack-chain models these nodes separately. A generic chain.merge()
  // loses nested parser options and splitChunks fields when Rsbuild composes
  // its environment defaults.
  chain.experiments(config.experiments);
  chain.externals(config.externals);
  chain.externalsType(config.externalsType);
  chain.module.parser.merge(config.module.parser);
  chain.optimization.runtimeChunk(config.optimization.runtimeChunk);
  chain.optimization.splitChunks(config.optimization.splitChunks);
}

export function applyCloudflareWorkerMfRuntimeBoundary(
  chain: Parameters<ModifyBundlerChainFn>[0],
) {
  // Module Federation remotes are not initialized in the Workerd graph. Keep
  // its shared runtime out of the compiler and replace the SSR data-fetch
  // registration with the same no-hook runtime-plugin contract.
  chain.plugins.delete('plugin-module-federation');
  chain.resolve.alias.set(
    `${MF_SSR_DATA_FETCH_RUNTIME_PLUGIN}$`,
    getCloudflareWorkerCompatFile(
      'cloudflare-worker-mf-ssr-runtime-plugin.mjs',
    ),
  );
  chain.resolve.alias.set(
    `${MF_SSR_DEV_RUNTIME_PLUGIN}$`,
    getCloudflareWorkerCompatFile(
      'cloudflare-worker-mf-ssr-runtime-plugin.mjs',
    ),
  );
}

function getEffectBffEntry(
  normalizedConfig: AppNormalizedConfig,
  appContext: AppToolsContext,
) {
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
}

function isCloudflareWorkerDeploy(normalizedConfig: AppNormalizedConfig) {
  return (
    normalizedConfig.deploy?.target === 'cloudflare' ||
    process.env.MODERNJS_DEPLOY === 'cloudflare'
  );
}

function getConsumingReactRuntimeAliases(appContext: AppToolsContext) {
  const resolvePaths = [appContext.appDirectory, process.cwd()];

  return {
    react$: resolvePackageFile('react', 'index.js', resolvePaths),
    'react/jsx-runtime$': resolvePackageFile(
      'react',
      'jsx-runtime.js',
      resolvePaths,
    ),
    'react/jsx-dev-runtime$': resolvePackageFile(
      'react',
      'jsx-dev-runtime.js',
      resolvePaths,
    ),
    'react/compiler-runtime$': resolvePackageFile(
      'react',
      'compiler-runtime.js',
      resolvePaths,
    ),
  };
}

function setResolvedAliases(
  alias: { set: (name: string, value: string) => unknown },
  aliases: Record<string, string | undefined>,
) {
  for (const [name, value] of Object.entries(aliases)) {
    setAliasIfPresent(alias, name, value);
  }
}

function appendBundlerChain(
  config: Omit<AppNormalizedConfig, 'plugins'>,
  handler: ModifyBundlerChainFn,
) {
  const bundlerChain = config.tools?.bundlerChain;

  config.tools = {
    ...config.tools,
    bundlerChain: bundlerChain
      ? Array.isArray(bundlerChain)
        ? [...bundlerChain, handler]
        : [bundlerChain, handler]
      : handler,
  };
}

function applySourceBuildReactRuntimeAliases(
  normalizedConfig: AppNormalizedConfig,
  appContext: AppToolsContext,
  tempBuilderConfig: Omit<AppNormalizedConfig, 'plugins'>,
) {
  if (!normalizedConfig.experiments?.sourceBuild) {
    return;
  }

  const aliases = getConsumingReactRuntimeAliases(appContext);

  if (!Object.values(aliases).some(Boolean)) {
    return;
  }

  appendBundlerChain(tempBuilderConfig, chain => {
    setResolvedAliases(chain.resolve.alias, aliases);
  });
}

export function getBuilderEnvironments(
  normalizedConfig: AppNormalizedConfig,
  appContext: AppToolsContext,
  tempBuilderConfig: Omit<AppNormalizedConfig, 'plugins'>,
) {
  applySourceBuildReactRuntimeAliases(
    normalizedConfig,
    appContext,
    tempBuilderConfig,
  );

  // create entries
  type Entries = Record<string, string[]>;
  const entries: Entries = {};
  const { entrypoints = [], checkedEntries } = appContext;
  for (const { entryName, internalEntry, entry } of entrypoints) {
    if (checkedEntries && !checkedEntries.includes(entryName)) {
      continue;
    }
    const finalEntry = internalEntry || entry;

    if (entryName in entries) {
      entries[entryName].push(finalEntry);
    } else {
      entries[entryName] = [finalEntry];
    }
  }

  const serverEntries: Entries = {};
  for (const entry in entries) {
    const v = entries[entry];
    serverEntries[entry] = v
      .map(entry => entry.replace('index.jsx', 'index.server.jsx'))
      .map(entry => entry.replace('bootstrap.jsx', 'bootstrap.server.jsx'));
  }

  const cloudflareWorkerServerEntries: Entries = {};
  for (const entry in entries) {
    const v = entries[entry];
    cloudflareWorkerServerEntries[entry] = v
      .map(entry => entry.replace('index.jsx', 'index.server.jsx'))
      .map(entry => entry.replace('bootstrap.jsx', 'index.server.jsx'));
  }

  const environments: RsbuildConfig['environments'] = {
    client: {
      output: {
        target: 'web',
      },
      source: {
        entry: entries,
      },
    },
  };

  // copy config should only works in main (client) environment
  if (tempBuilderConfig.output?.copy) {
    environments.client.output!.copy = tempBuilderConfig.output.copy;

    delete tempBuilderConfig.output.copy;
  }

  const useNodeTarget =
    isUseRsc(normalizedConfig) ||
    (isProd() ? isUseSSRBundle(normalizedConfig) : isSSR(normalizedConfig));

  if (useNodeTarget) {
    environments.server = {
      output: {
        target: 'node',
      },
      source: {
        entry: serverEntries,
      },
    };
  }

  const useWorkerTarget = isServiceWorker(normalizedConfig);

  if (useWorkerTarget) {
    const useCloudflareModuleWorker =
      isCloudflareWorkerDeploy(normalizedConfig);
    const effectApiEntry = useCloudflareModuleWorker
      ? getEffectBffEntry(normalizedConfig, appContext)
      : undefined;
    const tanstackRouterSsrServerFile = useCloudflareModuleWorker
      ? resolvePackageFile(
          '@tanstack/router-core',
          'dist/esm/ssr/ssr-server.js',
          [appContext.appDirectory, process.cwd()],
        )
      : undefined;
    const runtimeRscWorkerFile = useCloudflareModuleWorker
      ? resolvePackageFile(
          '@modern-js/runtime',
          'dist/esm/rsc/server.worker.mjs',
          [appContext.appDirectory, process.cwd()],
        )
      : undefined;
    const renderRscWorkerFile = useCloudflareModuleWorker
      ? resolvePackageFile('@modern-js/render', 'dist/esm/rscWorker.mjs', [
          appContext.appDirectory,
          process.cwd(),
        ])
      : undefined;
    const reactFile = useCloudflareModuleWorker
      ? resolvePackageFile('react', 'index.js', [
          appContext.appDirectory,
          process.cwd(),
        ])
      : undefined;
    const reactJsxRuntimeFile = useCloudflareModuleWorker
      ? resolvePackageFile('react', 'jsx-runtime.js', [
          appContext.appDirectory,
          process.cwd(),
        ])
      : undefined;
    const reactJsxDevRuntimeFile = useCloudflareModuleWorker
      ? resolvePackageFile('react', 'jsx-dev-runtime.js', [
          appContext.appDirectory,
          process.cwd(),
        ])
      : undefined;
    const reactDomFile = useCloudflareModuleWorker
      ? resolvePackageFile('react-dom', 'index.js', [
          appContext.appDirectory,
          process.cwd(),
        ])
      : undefined;
    const reactDomServerEdgeFile = useCloudflareModuleWorker
      ? resolvePackageFile('react-dom', 'server.edge.js', [
          appContext.appDirectory,
          process.cwd(),
        ])
      : undefined;
    const loadableComponentFile = useCloudflareModuleWorker
      ? resolvePackageFile('@loadable/component', 'dist/esm/loadable.esm.mjs', [
          appContext.appDirectory,
          process.cwd(),
          CLOUDFLARE_WORKER_COMPAT_TEMPLATE_DIR,
        ])
      : undefined;
    const loadableServerWorkerFile = useCloudflareModuleWorker
      ? getCloudflareWorkerCompatFile('cloudflare-worker-loadable-server.mjs')
      : undefined;
    const fsPromisesWorkerFile = useCloudflareModuleWorker
      ? getCloudflareWorkerCompatFile('cloudflare-worker-fs-promises.mjs')
      : undefined;
    const pathWorkerFile = useCloudflareModuleWorker
      ? getCloudflareWorkerCompatFile('cloudflare-worker-path.mjs')
      : undefined;
    const baseWorkerEntries = useCloudflareModuleWorker
      ? cloudflareWorkerServerEntries
      : serverEntries;
    const workerEntries = effectApiEntry
      ? {
          ...baseWorkerEntries,
          [BFF_EFFECT_WORKER_ENTRY_NAME]: [
            `${effectApiEntry}?${BFF_EFFECT_WORKER_RUNTIME_QUERY}`,
          ],
        }
      : baseWorkerEntries;

    environments[SERVICE_WORKER_ENVIRONMENT_NAME] = {
      output: {
        target: useCloudflareModuleWorker ? 'web' : 'web-worker',
        ...(useCloudflareModuleWorker ? { module: true } : {}),
      },
      source: {
        entry: workerEntries,
      },
      tools: {
        htmlPlugin: false,
        ...(useCloudflareModuleWorker
          ? {
              bundlerChain: chain => {
                // Workerd acceptance rejects runtime-selected module paths.
                // Eager mode keeps local lazy boundaries asynchronous while
                // lowering them to Promise continuations. A single runtime and
                // static shared chunk preserve module identity across route and
                // Effect BFF entries loaded in the same workerd isolate.
                applyCloudflareWorkerRspackConfig(
                  chain,
                  Object.keys(workerEntries),
                );
                chain.output
                  .module(true)
                  .library({ type: 'module' })
                  .publicPath('/')
                  .chunkFormat('module')
                  .chunkLoading('import')
                  .workerChunkLoading('import');
                // A Cloudflare module worker uses ESM output, but it is still
                // a server runtime. Keeping Rspack's target-web `browser`
                // condition makes packages such as TanStack Router resolve
                // client-only branches and changes the SSR React tree.
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
                // ADR-0021: generated hosts resolve a `.worker.tsx` boundary
                // module with no native remote imports. Exclude the Node Module
                // Federation runtime entirely: even initializing it would fetch
                // remote manifests at Worker global scope, which workerd forbids.
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
                  chain.resolve.alias.set(
                    '@modern-js/render/rsc$',
                    renderRscWorkerFile,
                  );
                  chain.resolve.alias.set(
                    '@modern-js/render/rsc',
                    renderRscWorkerFile,
                  );
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
                setAliasIfPresent(
                  chain.resolve.alias,
                  'react-dom$',
                  reactDomFile,
                );
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
                setAliasIfPresent(
                  chain.resolve.alias,
                  'node:path$',
                  pathWorkerFile,
                );
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
              },
            }
          : {}),
      },
    };
  }

  return {
    environments,
    builderConfig: tempBuilderConfig,
  };
}
