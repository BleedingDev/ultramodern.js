import path from 'node:path';
import {
  builderPluginAdapterBasic,
  builderPluginAdapterHooks,
  parseRspackConfig,
} from '@modern-js/app-tools/builder';
import type { CliPlugin } from '@modern-js/app-tools/cli-config';
import { createConfigOptions } from '@modern-js/plugin/cli';
import { getNodeEnv } from '@modern-js/utils';
import { loadUltramodernConfigFile } from './config';
import type {
  UltramodernAppUserConfig,
  UltramodernConfigLoader,
} from './types';

export interface ResolveUltramodernRsbuildConfigOptions {
  command: string;
  configPath?: string;
  cwd?: string;
  metaName?: string;
  modifyModernConfig?: (
    config: UltramodernAppUserConfig,
  ) => UltramodernAppUserConfig | Promise<UltramodernAppUserConfig>;
}

/** Resolve through the normal framework builder with the selected composition. */
export async function resolveUltramodernRsbuildConfig(
  options: ResolveUltramodernRsbuildConfigOptions,
) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  // Evaluate once with this caller's context, rather than the process's argv.
  const loaded = await loadUltramodernConfigFile({
    appDirectory: cwd,
    configFile: options.configPath,
    env: getNodeEnv(),
    command: options.command,
  });
  const configContextPlugin: CliPlugin<UltramodernConfigLoader> = {
    name: '@modern-js/ultramodern-config-context',
    setup(api) {
      api.updateAppContext({ configFile: loaded.configFile });
    },
  };
  const { config: modernConfig, getAppContext } =
    await createConfigOptions<UltramodernConfigLoader>({
      cwd,
      command: options.command,
      metaName: options.metaName ?? 'modern-js',
      configFile: false,
      config: loaded.config,
      // Keep the source config path available to consumer setup and adapters.
      internalPlugins: [configContextPlugin],
      modifyModernConfig: options.modifyModernConfig,
    });

  const { rsbuildConfig, rsbuildPlugins } = await parseRspackConfig(
    { ...modernConfig, plugins: modernConfig.builderPlugins },
    { cwd },
  );
  const adapterParams = {
    appContext: getAppContext(),
    normalizedConfig: modernConfig,
  };
  rsbuildConfig.plugins = [
    ...rsbuildPlugins,
    ...(rsbuildConfig.plugins ?? []),
    builderPluginAdapterBasic(adapterParams),
    builderPluginAdapterHooks(adapterParams),
  ];
  return { rsbuildConfig };
}
