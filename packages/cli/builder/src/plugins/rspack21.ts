import type { RsbuildPlugin } from '@rsbuild/core';

const PERSISTENT_CACHE_MAX_AGE = 7 * 24 * 60 * 60;
const PERSISTENT_CACHE_MAX_VERSIONS = 3;

export const pluginRspack21 = ({
  sourceImport,
}: {
  sourceImport?: boolean;
} = {}): RsbuildPlugin => ({
  name: 'modern-js:rspack-2-1-defaults',
  setup(api) {
    api.modifyRspackConfig(config => {
      config.module ??= {};
      config.module.parser ??= {};
      config.module.parser.javascript ??= {};
      config.module.parser.javascript.createRequire ??= true;

      if (
        typeof config.cache === 'object' &&
        config.cache !== null &&
        config.cache.type === 'persistent'
      ) {
        config.cache.maxAge ??= PERSISTENT_CACHE_MAX_AGE;
        config.cache.maxVersions ??= PERSISTENT_CACHE_MAX_VERSIONS;
      }

      if (sourceImport !== undefined) {
        config.experiments ??= {};
        config.experiments.sourceImport = sourceImport;
      }

      return config;
    });
  },
});
