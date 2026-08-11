import type {
  RsbuildConfig,
  RsbuildInstance,
  RsbuildPlugin,
} from '@rsbuild/core';
import { createRsbuild } from '@rsbuild/core';
import { getRscPlugins } from './plugins/rscConfig';
import { pluginRsdoctor } from './plugins/rsdoctor';
import { parseCommonConfig } from './shared/parseCommonConfig';
import { rscDisabledRuntimePlugin } from './shared/rsc/rscDisabledRuntime';
import type {
  BuilderConfig,
  CreateBuilderCommonOptions,
  CreateBuilderOptions,
} from './types';

export async function parseConfig(
  builderConfig: BuilderConfig,
  options: CreateBuilderCommonOptions,
): Promise<{
  rsbuildConfig: RsbuildConfig;
  rsbuildPlugins: RsbuildPlugin[];
}> {
  builderConfig.performance ??= {};
  builderConfig.performance.buildCache ??= true;

  const { rsbuildConfig, rsbuildPlugins, rsdoctorConfig } =
    await parseCommonConfig(builderConfig, options);

  const { sri } = builderConfig.security || {};
  if (sri) {
    if (sri === true) {
      rsbuildConfig.security!.sri = {
        enable: 'auto',
      };
    } else {
      const algorithm = Array.isArray(sri.hashFuncNames)
        ? (sri.hashFuncNames[0] as 'sha256' | 'sha384' | 'sha512')
        : undefined;

      rsbuildConfig.security!.sri = {
        enable: sri.enabled,
        algorithm,
      };
    }
  }

  if (Boolean(rsbuildConfig.tools!.lightningcssLoader) === false) {
    const { pluginPostcss } = await import('./plugins/postcss');
    rsbuildPlugins.push(
      pluginPostcss({ autoprefixer: builderConfig.tools?.autoprefixer }),
    );
  }

  const rscConfig = builderConfig.server?.rsc ?? false;
  const enableRsc = Boolean(rscConfig);
  if (enableRsc) {
    const rscEnvironments =
      typeof rscConfig === 'object' ? rscConfig.environments : undefined;
    const rscPlugins = await getRscPlugins(
      enableRsc,
      options.internalDirectory!,
      rscEnvironments,
    );
    rsbuildPlugins.push(...rscPlugins);
  } else {
    // Keep the disabled-runtime guard after user plugins so its final config
    // hook cannot be overwritten by a later resolver alias.
    rsbuildConfig.plugins = [
      ...(rsbuildConfig.plugins ?? []),
      rscDisabledRuntimePlugin(),
    ];
  }

  const rsdoctorPlugin = pluginRsdoctor(rsdoctorConfig);
  if (rsdoctorPlugin) {
    rsbuildPlugins.push(rsdoctorPlugin);
  }

  return {
    rsbuildConfig,
    rsbuildPlugins,
  };
}

export type BuilderInstance = RsbuildInstance;

export async function createRspackBuilder(
  options: CreateBuilderOptions,
): Promise<BuilderInstance> {
  const { cwd = process.cwd(), config, ...rest } = options;

  const { rsbuildConfig, rsbuildPlugins } = await parseConfig(config, {
    ...rest,
    cwd,
  });

  // builder plugins should be registered earlier than user plugins
  rsbuildConfig.plugins = [...rsbuildPlugins, ...(rsbuildConfig.plugins || [])];

  const rsbuild = await createRsbuild({
    cwd,
    rsbuildConfig,
  });

  return {
    ...rsbuild,
  };
}
