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
import pluginGenerator from '../utils/pluginGenerator';
import runtimeGenerator from '../utils/runtimeGenerator';
import { getPrimaryPrefix } from './prefix';
import {
  serializeServerGlobalVars,
  transformServerGlobalVars,
} from './serverGlobalVars';

const RUNTIME_CREATE_REQUEST = '@modern-js/plugin-bff/client';

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
            .then(async () => {
              if (bffRuntimeFramework !== 'effect') {
                return undefined;
              }

              const { bundleBuiltEffectEntryForNode } = await import(
                '@modern-js/plugin-bff-extensions/client-generator'
              );
              return bundleBuiltEffectEntryForNode({
                appDir: appDirectory,
                apiDir,
                distDir,
                effectEntry: modernConfig.bff?.effect?.entry,
                format: moduleType === 'module' ? 'esm' : 'cjs',
              });
            });
        });
    });

  const generate = () =>
    Promise.resolve().then(async () => {
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
      const requestId =
        bff?.requestId || packageJson.name || packageName || 'default';
      const operationContractsPromise =
        bffRuntimeFramework !== 'effect' && existLambda
          ? apiRouter.getApiHandlers().then(handlers =>
              buildOperationContractMap({
                handlers,
                requestId,
                operationVersion: deriveOperationVersion(packageJson.version),
              }),
            )
          : Promise.resolve({});

      const runtime = bff?.runtimeCreateRequest || RUNTIME_CREATE_REQUEST;
      const relativeApiPath = path.relative(appDirectory, apiDirectory);
      const relativeLambdaPath = path.relative(appDirectory, lambdaDir);
      const { sourceEffectEntry, relativeEffectEntry } =
        bffRuntimeFramework === 'effect'
          ? (
              await import('@modern-js/plugin-bff-extensions/client-generator')
            ).resolveEffectEntryPaths({
              appDir: appDirectory,
              apiDir: apiDirectory,
              effectEntry: bff?.effect?.entry,
            })
          : { sourceEffectEntry: undefined, relativeEffectEntry: '' };
      const clientGenerationPromise = clientGenerator({
        prefix,
        appDir: appDirectory,
        apiDir: apiDirectory,
        lambdaDir,
        existLambda,
        port,
        requestId,
        requestCreator: bff?.requestCreator,
        httpMethodDecider,
        relativeDistPath,
        relativeApiPath,
        apiFiles: apiRouter.getApiFiles(),
        bffRuntimeFramework,
        effectEntry: bff?.effect?.entry,
        effectDataPlatformBatch: bff?.effect?.dataPlatform?.batch,
      });

      return Promise.all([
        operationContractsPromise,
        clientGenerationPromise,
      ]).then(([lambdaContracts, generatedEffectClient]) => {
        if (
          bffRuntimeFramework === 'effect' &&
          generatedEffectClient === null
        ) {
          throw new Error(
            `Effect cross-project client generation failed for ${sourceEffectEntry ?? apiDirectory}.`,
          );
        }
        const operationContracts =
          bffRuntimeFramework === 'effect'
            ? (generatedEffectClient?.operationContracts ?? {})
            : lambdaContracts;
        return pluginGenerator({
          prefix,
          appDirectory,
          requestId,
          relativeDistPath,
          relativeApiPath,
          relativeLambdaPath,
          runtimeFramework: bffRuntimeFramework === 'hono' ? 'hono' : 'effect',
          relativeEffectEntry,
          operationContracts,
        }).then(() =>
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
