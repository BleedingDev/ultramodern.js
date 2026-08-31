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
import type { AppNormalizedConfig } from '../../types';
import type { AppToolsContext } from '../../types/plugin';

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
    environments[SERVICE_WORKER_ENVIRONMENT_NAME] = {
      output: {
        target: 'web-worker',
      },
      source: {
        entry: serverEntries,
      },
      tools: {
        htmlPlugin: false,
      },
    };
  }

  return {
    environments,
    builderConfig: tempBuilderConfig,
  };
}
