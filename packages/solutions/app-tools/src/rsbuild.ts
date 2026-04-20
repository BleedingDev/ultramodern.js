import { parseRspackConfig } from '@modern-js/builder';
import {
  builderPluginAdapterBasic,
  builderPluginAdapterHooks,
} from './builder/shared/builderPlugins';
import { DEFAULT_CONFIG_FILE } from './constants';
import type { AppNormalizedConfig, AppUserConfig } from './types';
import { getConfigFile } from './utils/getConfigFile';

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

type CreateConfigOptionsFn = (options: {
  command: string;
  cwd?: string;
  configFile: string;
  metaName?: string;
  modifyModernConfig?: (
    config: AppUserConfig,
  ) => AppUserConfig | Promise<AppUserConfig>;
}) => Promise<{
  config: AppNormalizedConfig;
  getAppContext: () => any;
}>;

const { createConfigOptions } = require('@modern-js/plugin/cli') as {
  createConfigOptions: CreateConfigOptionsFn;
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

  const { config: modernConfig, getAppContext } = await createConfigOptions({
    command: options.command,
    cwd,
    configFile,
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
