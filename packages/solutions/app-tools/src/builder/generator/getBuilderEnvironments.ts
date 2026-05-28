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
import type { RsbuildConfig } from '@rsbuild/core';
import type { AppNormalizedConfig } from '../../types';
import type { AppToolsContext } from '../../types/plugin';

const BFF_EFFECT_WORKER_ENTRY_NAME = '__modern_bff_effect';
const BFF_EFFECT_WORKER_RUNTIME_QUERY = 'modern-bff-runtime';
const JS_OR_TS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function findExistingFile(candidates: string[]) {
  return candidates.find(candidate => fs.existsSync(candidate));
}

function resolvePackageFile(
  packageName: string,
  filePath: string,
  paths: string[],
) {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`, {
      paths,
    });
    const packageFile = path.join(path.dirname(packageJsonPath), filePath);
    return fs.existsSync(packageFile)
      ? fs.realpathSync(packageFile)
      : undefined;
  } catch {
    return undefined;
  }
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
  const entryWithoutExtension = configuredEntry
    ? path.isAbsolute(configuredEntry)
      ? configuredEntry
      : path.resolve(appContext.appDirectory, configuredEntry)
    : path.resolve(appContext.apiDirectory, 'effect', 'index');

  return findExistingFile(
    JS_OR_TS_EXTS.map(extension => `${entryWithoutExtension}${extension}`),
  );
}

export function getBuilderEnvironments(
  normalizedConfig: AppNormalizedConfig,
  appContext: AppToolsContext,
  tempBuilderConfig: Omit<AppNormalizedConfig, 'plugins'>,
) {
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
      normalizedConfig.deploy?.target === 'cloudflare';
    const effectBffEntry = useCloudflareModuleWorker
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
    const baseWorkerEntries = useCloudflareModuleWorker
      ? cloudflareWorkerServerEntries
      : serverEntries;
    const workerEntries = effectBffEntry
      ? {
          ...baseWorkerEntries,
          [BFF_EFFECT_WORKER_ENTRY_NAME]: [
            `${effectBffEntry}?${BFF_EFFECT_WORKER_RUNTIME_QUERY}`,
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
                chain.merge({
                  experiments: {
                    outputModule: true,
                  },
                });
                chain.target('webworker');
                chain.plugins.delete('plugin-module-federation');
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
                chain.resolve.fallback.set('async_hooks', false);
                chain.resolve.fallback.set('node:async_hooks', false);
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
