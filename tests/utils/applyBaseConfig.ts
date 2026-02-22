import {
  type AppNormalizedConfig,
  type AppUserConfig,
  appTools,
  mergeConfig,
} from '@modern-js/app-tools';

export const applyBaseConfig = (config: AppUserConfig = {}) => {
  return mergeConfig<AppUserConfig, AppNormalizedConfig>([
    {
      output: {
        // disable polyfill and ts checker to make test faster
        polyfill: 'off',
        disableTsChecker: true,
      },
      performance: {
        buildCache: false,
      },
      plugins: [appTools()],
    },
    config,
  ]);
};
