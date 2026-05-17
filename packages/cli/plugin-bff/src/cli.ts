// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off processEnv:off strictBooleanExpressions:off unnecessaryArrowBlock:off
import type { AppTools, CliPlugin } from '@modern-js/app-tools';
import { ApiRouter } from '@modern-js/bff-core';
import type { ToolsDevServerConfig } from '@modern-js/builder';
import { compile } from '@modern-js/server-utils';
import type { ServerRoute } from '@modern-js/types';
import {
  type Alias,
  API_DIR,
  DEFAULT_API_PREFIX,
  fs,
  normalizeOutputPath,
  resolveServerTsconfig,
  SHARED_DIR,
} from '@modern-js/utils';
import type { ConfigChain } from '@rsbuild/core';
import type { IncomingMessage } from 'http';
import path from 'path';
import clientGenerator from './utils/clientGenerator';
import pluginGenerator from './utils/pluginGenerator';
import runtimeGenerator from './utils/runtimeGenerator';

const RUNTIME_CREATE_REQUEST = '@modern-js/plugin-bff/client';
const WATCHABLE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
  '.json',
];

const isWatchableBffFile = (filename: string) =>
  WATCHABLE_EXTENSIONS.some(ext => filename.endsWith(ext));

const normalizePrefixList = (prefix: string | string[] | undefined) => {
  if (Array.isArray(prefix)) {
    return prefix.filter(Boolean);
  }
  return [prefix || DEFAULT_API_PREFIX];
};

const getPrimaryPrefix = (prefix: string | string[] | undefined) =>
  normalizePrefixList(prefix)[0] || DEFAULT_API_PREFIX;

export const bffPlugin = (): CliPlugin<AppTools> => ({
  name: '@modern-js/plugin-bff',
  setup: api => {
    {
      const appContext = api.getAppContext();
      const userRuntimeFramework = api.getConfig()?.bff?.runtimeFramework;
      api.updateAppContext({
        ...appContext,
        bffRuntimeFramework:
          userRuntimeFramework === 'hono' ? 'hono' : 'effect',
      });
    }

    const compileApi = async () => {
      const {
        appDirectory,
        distDirectory,
        apiDirectory,
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

      const sourceDirs = [];
      if (await fs.pathExists(apiDir)) {
        sourceDirs.push(apiDir);
      }

      if (await fs.pathExists(sharedDir)) {
        sourceDirs.push(sharedDir);
      }

      const { alias } = modernConfig.source;
      const { alias: resolveAlias } = modernConfig.resolve;

      if (sourceDirs.length > 0) {
        const combinedAlias = ([] as unknown[])
          .concat(alias ?? [])
          .concat(resolveAlias ?? []) as ConfigChain<Alias>;
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
      }
    };

    const generator = async () => {
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
        await generator();
      }
    };

    const isHono = () => {
      const { bffRuntimeFramework } = api.getAppContext();
      return bffRuntimeFramework === 'hono';
    };

    const createCompressConfig = (
      devServer: ToolsDevServerConfig | undefined,
      prefix: string | string[],
    ) => {
      if (
        !devServer ||
        typeof devServer !== 'object' ||
        Array.isArray(devServer)
      ) {
        return undefined;
      }

      const { compress } = devServer;

      if (compress === undefined || compress === true) {
        const prefixes = normalizePrefixList(prefix);
        return {
          filter: (req: IncomingMessage) =>
            !prefixes.some(item => req.url?.includes(item)),
        };
      }

      if (compress === false) {
        return false;
      }

      return compress;
    };

    api.config(async () => {
      const devServer = api.getConfig()?.tools?.devServer;
      const prefix = api.getConfig()?.bff?.prefix || DEFAULT_API_PREFIX;

      const compress = createCompressConfig(devServer, prefix);

      return {
        tools: {
          devServer: {
            compress,
          },
          bundlerChain: (chain, { CHAIN_ID, isServer }) => {
            const {
              port,
              appDirectory,
              apiDirectory,
              lambdaDirectory,
              bffRuntimeFramework,
            } = api.getAppContext();
            const modernConfig = api.getNormalizedConfig();
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

            const apiRegexp = new RegExp(
              normalizeOutputPath(`${apiDirectory}${path.sep}.*(.[tj]s)$`),
            );

            const name = isServer ? 'server' : 'client';
            const sourceExt =
              process.env.MODERN_LIB_FORMAT === 'esm' ? 'mjs' : 'js';
            const loaderPath = path.join(__dirname, `loader.${sourceExt}`);
            chain.module.rule(CHAIN_ID.RULE.JS).exclude.add(apiRegexp);
            chain.module
              .rule('js-bff-api')
              .test(apiRegexp)
              .use('custom-loader')
              .loader(loaderPath.replace(/\\/g, '/'))
              .options({
                prefix,
                appDir: appDirectory,
                apiDir: apiDirectory,
                lambdaDir,
                existLambda,
                port,
                target: name,
                // Internal field
                requestCreator: bff?.requestCreator,
                httpMethodDecider,
                bffRuntimeFramework,
                effectEntry: bff?.effect?.entry,
                effectDataPlatformBatch: bff?.effect?.dataPlatform?.batch,
              });
          },
        },
      };
    });

    api.modifyServerRoutes(({ routes }) => {
      const modernConfig = api.getNormalizedConfig();

      const { bff } = modernConfig || {};
      const prefix = bff?.prefix || '/api';

      const prefixList: string[] = [];

      if (Array.isArray(prefix)) {
        prefixList.push(...prefix);
      } else {
        prefixList.push(prefix);
      }
      const apiServerRoutes = prefixList.map(pre => ({
        urlPath: pre,
        isApi: true,
        entryPath: '',
        isSPA: false,
        isSSR: false,
      })) as ServerRoute[];

      if (!isHono() && bff?.enableHandleWeb) {
        return {
          routes: (
            routes.map(route => {
              return {
                ...route,
                isApi: true,
              };
            }) as ServerRoute[]
          ).concat(apiServerRoutes),
        };
      }

      return { routes: routes.concat(apiServerRoutes) };
    });

    api._internalServerPlugins(({ plugins }) => {
      plugins.push({
        name: '@modern-js/plugin-bff/server-plugin',
      });
      return { plugins };
    });

    api.onBeforeDev(async () => {
      await handleCrossProjectInvocation();
    });

    api.onAfterBuild(async () => {
      await compileApi();
      await handleCrossProjectInvocation(true);
    });

    api.addWatchFiles(async () => {
      const appContext = api.getAppContext();
      const config = api.getNormalizedConfig();

      if (config?.bff?.crossProject) {
        return [appContext.apiDirectory, appContext.sharedDirectory].filter(
          Boolean,
        ) as string[];
      } else {
        return [];
      }
    });

    api.onFileChanged(async e => {
      const { filename, eventType, isPrivate } = e;
      const { appDirectory, apiDirectory, sharedDirectory } =
        api.getAppContext();
      const relativeApiPath = path.relative(appDirectory, apiDirectory);
      const relativeSharedPath = sharedDirectory
        ? path.relative(appDirectory, sharedDirectory)
        : '';
      const isApiFile = filename.startsWith(`${relativeApiPath}/`);
      const isSharedFile = relativeSharedPath
        ? filename.startsWith(`${relativeSharedPath}/`)
        : false;
      if (
        !isPrivate &&
        (eventType === 'add' ||
          eventType === 'change' ||
          eventType === 'unlink') &&
        (isApiFile || isSharedFile) &&
        isWatchableBffFile(filename)
      ) {
        await handleCrossProjectInvocation();
      }
    });
  },
});

export default bffPlugin;
