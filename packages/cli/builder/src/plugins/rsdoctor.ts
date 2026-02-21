import type { RsbuildPlugin } from '@rsbuild/core';
import type { RsdoctorUserConfig } from '../types';

const isRsdoctorEnabled = (
  config: RsdoctorUserConfig | undefined,
  defaultEnabled: boolean,
) => {
  if (config === undefined) {
    return defaultEnabled;
  }
  if (typeof config === 'boolean') {
    return config;
  }
  if (typeof config?.enabled === 'boolean') {
    return config.enabled;
  }
  return defaultEnabled;
};

export const pluginRsdoctor = (
  config: RsdoctorUserConfig | undefined,
  defaultEnabled: boolean,
): RsbuildPlugin | null => {
  if (!isRsdoctorEnabled(config, defaultEnabled)) {
    return null;
  }

  return {
    name: 'builder:rsdoctor',
    setup(api) {
      api.modifyBundlerChain(async chain => {
        const { RsdoctorRspackPlugin } = await import(
          '@rsdoctor/rspack-plugin'
        );
        chain.plugin('rsdoctor').use(RsdoctorRspackPlugin);
      });
    },
  };
};
