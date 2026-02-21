import type {
  BundlerConfig,
  DefaultBuilderPlugin,
  BundlerChain,
  RsdoctorConfig,
  SharedNormalizedConfig,
} from '@modern-js/builder-shared';

function applyProfile({
  chain,
  config,
}: {
  chain: BundlerChain;
  config: SharedNormalizedConfig;
}) {
  const { profile } = config.performance;
  if (!profile) {
    return;
  }

  chain.profile(profile);
}

const isRsdoctorEnabled = (
  config: RsdoctorConfig | undefined,
  defaultEnabled: boolean,
) => {
  if (config === undefined) {
    return defaultEnabled;
  }

  if (typeof config === 'boolean') {
    return config;
  }

  if (typeof config.enabled === 'boolean') {
    return config.enabled;
  }

  return defaultEnabled;
};

const getRsdoctorPluginOptions = (
  config: RsdoctorConfig | undefined,
): { disableClientServer: boolean } => {
  if (config && typeof config === 'object') {
    return {
      disableClientServer: config.disableClientServer ?? true,
    };
  }

  return {
    disableClientServer: true,
  };
};

/**
 * Apply some configs of builder performance
 */
export const builderPluginPerformance = (): DefaultBuilderPlugin => ({
  name: 'builder-plugin-performance',

  setup(api) {
    api.modifyBuilderConfig(builderConfig => {
      if (builderConfig.performance?.profile) {
        // generate stats.json
        if (!builderConfig.performance?.bundleAnalyze) {
          builderConfig.performance ??= {};
          builderConfig.performance.bundleAnalyze = {
            analyzerMode: 'disabled',
            generateStatsFile: true,
          };
        } else {
          builderConfig.performance.bundleAnalyze = {
            generateStatsFile: true,
            ...(builderConfig.performance.bundleAnalyze || {}),
          };
        }
      }
    });
    api.modifyBundlerChain(chain => {
      const config = api.getNormalizedConfig();

      applyProfile({ chain, config });
    });

    api.onBeforeCreateCompiler(async ({ bundlerConfigs }) => {
      if (api.context.bundlerType !== 'rspack') {
        return;
      }

      const rsdoctorConfig = api.getNormalizedConfig().performance.rsdoctor;
      const isProd = process.env.NODE_ENV === 'production';

      if (!isRsdoctorEnabled(rsdoctorConfig, isProd)) {
        return;
      }

      const { RsdoctorRspackPlugin } = await import('@rsdoctor/rspack-plugin');
      const rsdoctorPluginOptions = getRsdoctorPluginOptions(rsdoctorConfig);

      (bundlerConfigs as BundlerConfig[]).forEach(config => {
        config.plugins ??= [];
        config.plugins.push(new RsdoctorRspackPlugin(rsdoctorPluginOptions));
      });
    });
  },
});
