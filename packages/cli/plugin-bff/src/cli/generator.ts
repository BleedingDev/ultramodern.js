import type { AppTools } from '@modern-js/app-tools';
import { ApiRouter } from '@modern-js/bff-core';
import type { CLIPluginAPI } from '@modern-js/plugin';
import { compile } from '@modern-js/server-utils';
import {
  type Alias,
  API_DIR,
  fs,
  resolveServerTsconfig,
  SHARED_DIR,
} from '@modern-js/utils';
import type { ConfigChain } from '@rsbuild/core';
import path from 'path';
import clientGenerator from '../utils/clientGenerator';
import { bundleEffectEntryForNode } from '../utils/effectSourceLoader';
import pluginGenerator from '../utils/pluginGenerator';
import runtimeGenerator from '../utils/runtimeGenerator';
import { getPrimaryPrefix } from './prefix';
import {
  serializeServerGlobalVars,
  transformServerGlobalVars,
} from './serverGlobalVars';

const RUNTIME_CREATE_REQUEST = '@modern-js/plugin-bff/client';
const effectEntryExtensions = [
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.mts',
  '.cjs',
  '.cts',
];

function resolveEffectSourceEntry(
  appDirectory: string,
  apiDirectory: string,
  configuredEntry?: string,
) {
  const entry = configuredEntry
    ? path.isAbsolute(configuredEntry)
      ? configuredEntry
      : path.resolve(appDirectory, configuredEntry)
    : path.resolve(apiDirectory, 'index');
  return path.extname(entry)
    ? entry
    : effectEntryExtensions
        .map(extension => `${entry}${extension}`)
        .find(candidate => fs.existsSync(candidate));
}

function resolveBuiltEffectEntry(
  appDirectory: string,
  distDirectory: string,
  sourceEntry: string | undefined,
) {
  if (!sourceEntry) {
    return undefined;
  }
  const relativeEntry = path.relative(appDirectory, sourceEntry);
  if (relativeEntry === '..' || relativeEntry.startsWith(`..${path.sep}`)) {
    throw new Error(
      `Effect BFF entry must be inside the application directory: ${sourceEntry}`,
    );
  }
  const builtEntry = path
    .resolve(distDirectory, relativeEntry)
    .replace(/\.(?:[cm]?ts|tsx|jsx)$/u, '.js');
  return fs.existsSync(builtEntry) ? builtEntry : undefined;
}

export const createBffGenerator = (api: CLIPluginAPI<AppTools>) => {
  const compileApi = async () => {
    const {
      appDirectory,
      distDirectory,
      apiDirectory,
      bffRuntimeFramework,
      sharedDirectory,
      moduleType,
    } = api.getAppContext();
    const modernConfig = api.getNormalizedConfig();

    const distDir = path.resolve(distDirectory);
    const apiDir = apiDirectory || path.resolve(appDirectory, API_DIR);
    const sharedDir = sharedDirectory || path.resolve(appDirectory, SHARED_DIR);
    const tsconfigPath = resolveServerTsconfig(
      appDirectory,
      modernConfig?.server?.tsconfigPath,
    );

    const sourceDirs: string[] = [];
    if (await fs.pathExists(apiDir)) {
      sourceDirs.push(apiDir);
    }

    if (await fs.pathExists(sharedDir)) {
      sourceDirs.push(sharedDir);
    }

    const { alias, globalVars } = modernConfig.source;
    const { alias: resolveAlias } = modernConfig.resolve;

    if (sourceDirs.length > 0) {
      const combinedAlias = ([] as unknown[])
        .concat(alias ?? [])
        .concat(resolveAlias ?? []) as ConfigChain<Alias>;
      const serializedGlobalVars = serializeServerGlobalVars(globalVars);
      await compile(
        appDirectory,
        {
          alias: combinedAlias,
        },
        {
          sourceDirs,
          distDir,
          tsconfigPath,
          moduleType,
          throwErrorInsteadOfExit: true,
        },
      );
      await transformServerGlobalVars(
        sourceDirs.map(sourceDir =>
          path.resolve(distDir, path.relative(appDirectory, sourceDir)),
        ),
        serializedGlobalVars,
      );

      if (bffRuntimeFramework === 'effect') {
        const sourceEntry = resolveEffectSourceEntry(
          appDirectory,
          apiDir,
          modernConfig.bff?.effect?.entry,
        );
        const builtEntry = resolveBuiltEffectEntry(
          appDirectory,
          distDir,
          sourceEntry,
        );
        if (!builtEntry) {
          throw new Error(
            `Effect BFF entry was not emitted into ${distDir}: ${
              sourceEntry ?? path.resolve(apiDir, 'index')
            }`,
          );
        }
        await bundleEffectEntryForNode({
          appDir: appDirectory,
          entryPath: builtEntry,
          format: moduleType === 'module' ? 'esm' : 'cjs',
        });
      }
    }
  };

  const generate = async () => {
    const {
      appDirectory,
      apiDirectory,
      lambdaDirectory,
      port,
      bffRuntimeFramework,
    } = api.getAppContext();

    const modernConfig = api.getNormalizedConfig();
    const relativeDistPath = modernConfig?.output?.distPath?.root || 'dist';
    const { bff } = modernConfig || {};
    const prefix = getPrimaryPrefix(bff?.prefix);
    const httpMethodDecider = bff?.httpMethodDecider;

    const apiRouter = new ApiRouter({
      apiDir: apiDirectory,
      appDir: appDirectory,
      lambdaDir: lambdaDirectory,
      prefix,
      httpMethodDecider,
      isBuild: true,
    });

    const lambdaDir = apiRouter.getLambdaDir();
    const existLambda = apiRouter.isExistLambda();

    const runtime = bff?.runtimeCreateRequest || RUNTIME_CREATE_REQUEST;
    const relativeApiPath = path.relative(appDirectory, apiDirectory);
    const relativeLambdaPath = path.relative(appDirectory, lambdaDir);

    await pluginGenerator({
      prefix,
      appDirectory,
      relativeDistPath,
      relativeApiPath,
      relativeLambdaPath,
      runtimeFramework: bffRuntimeFramework === 'hono' ? 'hono' : 'effect',
    });
    await clientGenerator({
      prefix,
      appDir: appDirectory,
      apiDir: apiDirectory,
      lambdaDir,
      existLambda,
      port,
      requestCreator: bff?.requestCreator,
      httpMethodDecider,
      relativeDistPath,
      relativeApiPath,
      bffRuntimeFramework,
      effectEntry: bff?.effect?.entry,
      effectDataPlatformBatch: bff?.effect?.dataPlatform?.batch,
    });
    await runtimeGenerator({
      runtime,
      appDirectory,
      relativeDistPath,
    });
  };

  const handleCrossProjectInvocation = async (isBuild = false) => {
    const { bff } = api.getNormalizedConfig();
    if (bff?.crossProject) {
      if (!isBuild) {
        await compileApi();
      }
      await generate();
    }
  };

  return {
    compileApi,
    generate,
    handleCrossProjectInvocation,
  };
};
