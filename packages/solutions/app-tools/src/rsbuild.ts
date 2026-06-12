import { parseRspackConfig } from '@modern-js/builder';
import { createConfigOptions } from '@modern-js/plugin/cli';
import { INTERNAL_RUNTIME_PLUGINS } from '@modern-js/utils';
import {
  builderPluginAdapterBasic,
  builderPluginAdapterHooks,
} from './builder/shared/builderPlugins';
import { DEFAULT_CONFIG_FILE } from './constants';
import type { AppNormalizedConfig, AppTools, AppUserConfig } from './types';
import { getConfigFile } from './utils/getConfigFile';
import { loadInternalPlugins } from './utils/loadPlugins';

const MODERN_META_NAME = 'modern-js';

type ResolveModernRsbuildConfigOptions = {
  command: string;
  configPath?: string;
  cwd?: string;
  metaName?: string;
  modifyModernConfig?: (
    config: AppUserConfig,
  ) => AppUserConfig | Promise<AppUserConfig>;
};

export async function resolveModernRsbuildConfig(
  options: ResolveModernRsbuildConfigOptions,
) {
  const { cwd = process.cwd(), metaName = MODERN_META_NAME } = options;

  const configFile = options.configPath || getConfigFile(undefined, cwd);

  if (!configFile) {
    throw new Error(
      `Cannot find config file in ${cwd}. Please make sure you have a ${DEFAULT_CONFIG_FILE} file in your project.`,
    );
  }

  const { config: modernConfig, getAppContext } =
    await createConfigOptions<AppTools>({
      command: options.command,
      cwd,
      configFile,
      internalPlugins: await loadInternalPlugins(cwd, INTERNAL_RUNTIME_PLUGINS),
      metaName,
      modifyModernConfig: options.modifyModernConfig,
    });

  const nonStandardConfig = {
    ...modernConfig,
    plugins: modernConfig.builderPlugins,
  };

  const appContext = getAppContext();

  const { rsbuildConfig, rsbuildPlugins } = await parseRspackConfig(
    nonStandardConfig,
    {
      cwd,
    },
  );

  const adapterParams = {
    appContext,
    normalizedConfig: modernConfig as AppNormalizedConfig,
  };

  rsbuildConfig.plugins = [
    ...rsbuildPlugins,
    ...(rsbuildConfig.plugins || []),
    builderPluginAdapterBasic(adapterParams),
    builderPluginAdapterHooks(adapterParams),
  ];

  return { rsbuildConfig };
}

export type { ResolveModernRsbuildConfigOptions };
