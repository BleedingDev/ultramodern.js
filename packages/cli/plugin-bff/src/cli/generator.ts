import type { AppTools } from '@modern-js/app-tools';
import {
  ApiRouter,
  buildOperationContractMap,
  deriveOperationVersion,
} from '@modern-js/bff-core';
import type { CLIPluginAPI } from '@modern-js/plugin';
import { compile } from '@modern-js/server-utils';
import {
  type Alias,
  API_DIR,
  fs,
  upath as path,
  resolveServerTsconfig,
  SHARED_DIR,
} from '@modern-js/utils';
import type { ConfigChain } from '@rsbuild/core';
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
  const entry =
    configuredEntry !== undefined && configuredEntry.length > 0
      ? path.isAbsolute(configuredEntry)
        ? configuredEntry
        : path.resolve(appDirectory, configuredEntry)
      : path.resolve(apiDirectory, 'index');
  return path.extname(entry).length > 0
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
  if (sourceEntry === undefined || sourceEntry.length === 0) {
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
  const compileApi = () =>
    Promise.resolve().then(() => {
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
      const sharedDir =
        sharedDirectory || path.resolve(appDirectory, SHARED_DIR);
      const tsconfigPath = resolveServerTsconfig(
        appDirectory,
        modernConfig?.server?.tsconfigPath,
      );

      const sourceDirs: string[] = [];
      return fs
        .pathExists(apiDir)
        .then(apiDirectoryExists => {
          if (apiDirectoryExists) {
            sourceDirs.push(apiDir);
          }
          return fs.pathExists(sharedDir);
        })
        .then(sharedDirectoryExists => {
          if (sharedDirectoryExists) {
            sourceDirs.push(sharedDir);
          }

          if (sourceDirs.length === 0) {
            return undefined;
          }

          const { alias, globalVars } = modernConfig.source;
          const { alias: resolveAlias } = modernConfig.resolve;
          const combinedAlias = ([] as unknown[])
            .concat(alias ?? [])
            .concat(resolveAlias ?? []) as ConfigChain<Alias>;
          const serializedGlobalVars = serializeServerGlobalVars(globalVars);

          return compile(
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
          )
            .then(() =>
              transformServerGlobalVars(
                sourceDirs.map(sourceDir =>
                  path.resolve(distDir, path.relative(appDirectory, sourceDir)),
                ),
                serializedGlobalVars,
              ),
            )
            .then(() => {
              if (bffRuntimeFramework !== 'effect') {
                return undefined;
              }

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
              if (builtEntry === undefined || builtEntry.length === 0) {
                throw new Error(
                  `Effect BFF entry was not emitted into ${distDir}: ${
                    sourceEntry ?? path.resolve(apiDir, 'index')
                  }`,
                );
              }
              return bundleEffectEntryForNode({
                appDir: appDirectory,
                entryPath: builtEntry,
                format: moduleType === 'module' ? 'esm' : 'cjs',
              });
            });
        });
    });

  const generate = () =>
    Promise.resolve().then(() => {
      const {
        appDirectory,
        apiDirectory,
        lambdaDirectory,
        port,
        bffRuntimeFramework,
        packageName,
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

      const packageJson = fs.readJSONSync(
        path.resolve(appDirectory, 'package.json'),
      ) as {
        name?: string;
        version?: string;
      };
      const requestId = packageJson.name || packageName;
      const operationContractsPromise = existLambda
        ? apiRouter.getApiHandlers().then(handlers =>
            buildOperationContractMap({
              handlers,
              requestId,
              operationVersion: deriveOperationVersion(packageJson.version),
            }),
          )
        : Promise.resolve({});

      return operationContractsPromise.then(operationContracts => {
        const runtime = bff?.runtimeCreateRequest || RUNTIME_CREATE_REQUEST;
        const relativeApiPath = path.relative(appDirectory, apiDirectory);
        const relativeLambdaPath = path.relative(appDirectory, lambdaDir);
        const sourceEffectEntry =
          bffRuntimeFramework === 'effect'
            ? resolveEffectSourceEntry(
                appDirectory,
                apiDirectory,
                bff?.effect?.entry,
              )
            : undefined;
        const relativeEffectEntry =
          sourceEffectEntry !== undefined && sourceEffectEntry.length > 0
            ? path
                .relative(appDirectory, sourceEffectEntry)
                .replace(/\.(?:[cm]?ts|tsx|jsx)$/u, '.js')
            : '';

        return pluginGenerator({
          prefix,
          appDirectory,
          relativeDistPath,
          relativeApiPath,
          relativeLambdaPath,
          runtimeFramework: bffRuntimeFramework === 'hono' ? 'hono' : 'effect',
          relativeEffectEntry,
          operationContracts,
        })
          .then(() =>
            clientGenerator({
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
              apiFiles: apiRouter.getApiFiles(),
              bffRuntimeFramework,
              effectEntry: bff?.effect?.entry,
              effectDataPlatformBatch: bff?.effect?.dataPlatform?.batch,
            }),
          )
          .then(() =>
            runtimeGenerator({
              runtime,
              appDirectory,
              relativeDistPath,
            }),
          );
      });
    });

  const handleCrossProjectInvocation = (isBuild = false) =>
    Promise.resolve().then(() => {
      const { bff } = api.getNormalizedConfig();
      if (bff?.crossProject !== true) {
        return undefined;
      }
      return isBuild ? generate() : compileApi().then(() => generate());
    });

  return {
    compileApi,
    generate,
    handleCrossProjectInvocation,
  };
};
