import type { RsbuildPlugin } from '@rsbuild/core';
import type { RsdoctorUserConfig } from '../types';

const isRsdoctorEnabled = (config: RsdoctorUserConfig | undefined) => {
  if (config === undefined) {
    return false;
  }
  if (typeof config === 'boolean') {
    return config;
  }
  if (typeof config?.enabled === 'boolean') {
    return config.enabled;
  }
  return true;
};

const getRsdoctorPluginOptions = (
  config: RsdoctorUserConfig | undefined,
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

export const pluginRsdoctor = (
  config: RsdoctorUserConfig | undefined,
): RsbuildPlugin | null => {
  if (!isRsdoctorEnabled(config)) {
    return null;
  }

  const pluginOptions = getRsdoctorPluginOptions(config);

  return {
    name: 'builder:rsdoctor',
    setup(api) {
      api.modifyBundlerChain(async chain => {
        const { RsdoctorRspackPlugin } = await import(
          '@rsdoctor/rspack-plugin'
        );
        chain.plugin('rsdoctor').use(RsdoctorRspackPlugin, [pluginOptions]);
      });
    },
  };
};
