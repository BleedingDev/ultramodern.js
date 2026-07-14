// @effect-diagnostics globalConsole:off nodeBuiltinImport:off processEnv:off strictBooleanExpressions:off unnecessaryArrowBlock:off
import type {
  AppTools,
  AppToolsNormalizedConfig,
  CliPlugin,
  ServerUserConfig,
} from '@modern-js/app-tools';
import type { CLIPluginAPI } from '@modern-js/plugin';
import type { Entrypoint } from '@modern-js/types';
import { isUseSSRBundle, LOADABLE_STATS_FILE } from '@modern-js/utils';
import type {
  MergedEnvironmentConfig,
  RsbuildPlugin,
  RspackChain,
} from '@rsbuild/core';
import path from 'path';
import LoadableBundlerPlugin from './loadable-bundler-plugin';
import { resolveSSRMode } from './mode';

type RsbuildRspackPluginLike =
  | string
  | ((...args: any[]) => any)
  | {
      name?: string;
      constructor?: {
        name?: string;
      };
    }
  | [unknown, ...unknown[]];

type EnvironmentConfigLike = Partial<
  Pick<MergedEnvironmentConfig, 'output' | 'source' | 'tools'>
>;

const getRspackPlugins = (rspackConfig: unknown): RsbuildRspackPluginLike[] => {
  if (!rspackConfig) {
    return [];
  }

  const rspackEntries = Array.isArray(rspackConfig)
    ? rspackConfig
    : [rspackConfig];
  const plugins: RsbuildRspackPluginLike[] = [];

  for (const entry of rspackEntries) {
    if (!entry || typeof entry === 'function' || typeof entry !== 'object') {
      continue;
    }

    const maybePlugins = (entry as { plugins?: unknown }).plugins;

    if (!Array.isArray(maybePlugins)) {
      continue;
    }

    for (const plugin of maybePlugins) {
      if (plugin) {
        plugins.push(plugin as RsbuildRspackPluginLike);
      }
    }
  }

  return plugins;
};

const getRspackPluginName = (
  plugin: RsbuildRspackPluginLike,
): string | undefined => {
  if (typeof plugin === 'string') {
    return plugin;
  }

  if (typeof plugin === 'function') {
    return plugin.name;
  }

  if (Array.isArray(plugin)) {
    const [first] = plugin;

    if (!first) {
      return undefined;
    }

    if (typeof first === 'string') {
      return first;
    }

    if (typeof first === 'function') {
      return first.name;
    }

    if (typeof first === 'object') {
      return (
        (first as { name?: string }).name ||
        (first as { constructor?: { name?: string } }).constructor?.name
      );
    }

    return undefined;
  }

  return plugin.name || plugin.constructor?.name;
};

const hasStringSSREntry = (userConfig: AppToolsNormalizedConfig): boolean => {
  const isStreaming = (ssr: ServerUserConfig['ssr']) =>
    ssr && typeof ssr === 'object' && ssr.mode === 'stream';

  const { server, output } = userConfig;

  // ssg need use stringSSR.
  if (output?.ssg) {
    return true;
  }

  if (output?.ssgByEntries && Object.keys(output.ssgByEntries).length > 0) {
    return true;
  }

  if (server?.ssr && !isStreaming(server.ssr)) {
    return true;
  }

  if (server?.ssrByEntries && typeof server.ssrByEntries === 'object') {
    for (const name of Object.keys(server.ssrByEntries)) {
      if (
        server.ssrByEntries[name] &&
        !isStreaming(server.ssrByEntries[name])
      ) {
        return true;
      }
    }
  }

  return false;
};

const hasServerRenderingConfig = (
  userConfig: AppToolsNormalizedConfig,
): boolean => {
  const { output, server } = userConfig;

  if (output?.ssg) {
    return true;
  }

  if (output?.ssgByEntries && Object.keys(output.ssgByEntries).length > 0) {
    return true;
  }

  if (server?.ssr) {
    return true;
  }

  if (server?.ssrByEntries && Object.keys(server.ssrByEntries).length > 0) {
    return true;
  }

  return false;
};

const isModuleFederationAppSSREnabledInConfig = (
  ssr: ServerUserConfig['ssr'],
): boolean => {
  if (!ssr || typeof ssr !== 'object') {
    return false;
  }

  return ssr.moduleFederationAppSSR === true;
};

const isModuleFederationAppSSREnabled = (
  userConfig: AppToolsNormalizedConfig,
): boolean => {
  if (isModuleFederationAppSSREnabledInConfig(userConfig.server?.ssr)) {
    return true;
  }

  if (
    userConfig.server?.ssrByEntries &&
    typeof userConfig.server.ssrByEntries === 'object'
  ) {
    return Object.values(userConfig.server.ssrByEntries).some(
      isModuleFederationAppSSREnabledInConfig,
    );
  }

  return false;
};

/**
 * Check if any entry uses string SSR mode.
 * Returns true if at least one entry uses 'string' SSR mode.
 */
const checkUseStringSSR = (
  config: AppToolsNormalizedConfig,
  appDirectory?: string,
  entrypoints?: Entrypoint[],
): boolean => {
  // If entrypoints are provided, check each entry
  if (entrypoints && entrypoints.length > 0) {
    for (const entrypoint of entrypoints) {
      const ssrMode = resolveSSRMode({
        entry: entrypoint.entryName,
        config,
        appDirectory,
        nestedRoutesEntry: entrypoint.nestedRoutesEntry,
      });
      if (ssrMode === 'string') {
        return true;
      }
    }
    return false;
  }

  return true;
};

const isModuleFederationRspackPlugin = (
  plugin: RsbuildRspackPluginLike,
): boolean => {
  const candidate = getRspackPluginName(plugin);

  return typeof candidate === 'string' && /modulefederation/i.test(candidate);
};

const hasModuleFederationMarker = (config: EnvironmentConfigLike): boolean => {
  if (process.env.MF_SSR_PRJ === 'true') {
    return true;
  }

  const define = config.source?.define || {};

  if ('REMOTE_IP_STRATEGY' in define || 'FEDERATION_IPV4' in define) {
    return true;
  }

  const plugins = getRspackPlugins(config.tools?.rspack);

  return plugins.some(isModuleFederationRspackPlugin);
};

const isNodeEnvironmentTarget = (target: unknown): boolean =>
  typeof target === 'string' &&
  (target === 'node' || target === 'async-node' || target.startsWith('node'));

export const shouldUseModuleFederationNodeOutput = (
  config: EnvironmentConfigLike,
): boolean =>
  isNodeEnvironmentTarget(config.output?.target) &&
  hasModuleFederationMarker(config);

const ssrBuilderPlugin = (
  modernAPI: CLIPluginAPI<AppTools>,
  outputModule: boolean,
  exportLoadablePath: string,
): RsbuildPlugin => ({
  name: '@modern-js/builder-plugin-ssr',

  setup(api) {
    api.modifyEnvironmentConfig((config, { name, mergeEnvironmentConfig }) => {
      const isServerEnvironment =
        isNodeEnvironmentTarget(config.output.target) || name === 'workerSSR';
      const userConfig = modernAPI.getNormalizedConfig();
      const hasServerRendering = hasServerRenderingConfig(userConfig);
      const hasModuleFederationRuntimeMarker =
        hasServerRendering && shouldUseModuleFederationNodeOutput(config);
      const hasExplicitMfSsrFlag = isModuleFederationAppSSREnabled(userConfig);
      const requireExplicitMfSsrFlag =
        process.env.MODERN_MF_APP_SSR_REQUIRE_EXPLICIT === 'true';

      if (
        hasServerRendering &&
        hasModuleFederationRuntimeMarker &&
        !hasExplicitMfSsrFlag
      ) {
        const warningMessage =
          '[modernjs][mf-ssr] Module Federation SSR was auto-detected from runtime markers. Set server.ssr.moduleFederationAppSSR=true explicitly in host and remotes to avoid heuristic drift.';
        if (requireExplicitMfSsrFlag) {
          throw new Error(
            `${warningMessage} (enforced by MODERN_MF_APP_SSR_REQUIRE_EXPLICIT=true)`,
          );
        }
        // eslint-disable-next-line no-console
        console.warn(warningMessage);
      }
      const isModuleFederationAppSSR =
        hasServerRendering && hasExplicitMfSsrFlag;
      // Maybe we can enable it for node 18 and above, but we can't ensure it in the compilation.
      const ssrEnv =
        userConfig.deploy?.worker?.ssr || userConfig.server?.rsc
          ? 'edge'
          : 'node';

      const appContext = modernAPI.getAppContext();
      const { appDirectory, entrypoints } = appContext;

      const useLoadablePlugin =
        isUseSSRBundle(userConfig) &&
        !isServerEnvironment &&
        checkUseStringSSR(userConfig, appDirectory, entrypoints);

      const outputConfig = {
        module:
          isServerEnvironment &&
          (outputModule ||
            (name === 'workerSSR' &&
              userConfig.deploy?.target === 'cloudflare')),
      };

      const useLoadableComponents =
        isUseSSRBundle(userConfig) &&
        checkUseStringSSR(userConfig, appDirectory, entrypoints);

      return mergeEnvironmentConfig(config, {
        source: {
          define: {
            'process.env.MODERN_TARGET': isServerEnvironment
              ? JSON.stringify('node')
              : JSON.stringify('browser'),
            'process.env.MODERN_SSR_ENV': JSON.stringify(ssrEnv),
            'process.env.MODERN_ENABLE_HYDRATION': JSON.stringify(
              isUseSSRBundle(userConfig),
            ),
            'process.env.MODERN_ENABLE_RSC': JSON.stringify(
              Boolean(userConfig.server?.rsc),
            ),
            'process.env.MODERN_MF_APP_SSR': JSON.stringify(
              isModuleFederationAppSSR,
            ),
          },
        },
        output: outputConfig,
        tools: {
          bundlerChain: useLoadablePlugin
            ? (chain: RspackChain) => {
                chain
                  .plugin('loadable')
                  .use(LoadableBundlerPlugin, [
                    { filename: LOADABLE_STATS_FILE },
                  ]);
              }
            : undefined,
          swc: useLoadableComponents
            ? {
                jsc: {
                  experimental: {
                    plugins: [
                      [
                        require.resolve('@swc/plugin-loadable-components'),
                        {
                          signatures: [
                            { name: 'default', from: '@loadable/component' },
                            { name: 'lazy', from: '@loadable/component' },
                            {
                              name: 'default',
                              from: exportLoadablePath,
                            },
                            {
                              name: 'lazy',
                              from: exportLoadablePath,
                            },
                          ],
                        },
                      ],
                    ],
                  },
                },
              }
            : undefined,
        },
      });
    });
  },
});

export const ssrPlugin = (): CliPlugin<AppTools> => ({
  name: '@modern-js/plugin-ssr',

  required: ['@modern-js/runtime'],

  setup: api => {
    const appContext = api.getAppContext();
    const exportLoadablePath = `@${appContext.metaName}/runtime/loadable`;
    const runtimeUtilsPath = require.resolve('@modern-js/runtime-utils/node');
    const aliasPath = runtimeUtilsPath
      .replace(`${path.sep}cjs${path.sep}`, `${path.sep}esm${path.sep}`)
      .replace(/\.js$/, '.mjs');

    api.config(() => {
      return {
        builderPlugins: [
          ssrBuilderPlugin(
            api,
            appContext.moduleType === 'module',
            exportLoadablePath,
          ),
        ],
        resolve: {
          alias: {
            // ensure that all packages use the same storage in @modern-js/runtime-utils/node
            '@modern-js/runtime-utils/node$': aliasPath,
          },
        },
      };
    });
  },
});

export default ssrPlugin;
