import { rslibConfig, ts7DtsConfig } from '@modern-js/rslib';
import { defineConfig } from '@rslib/core';

export default defineConfig({
  ...rslibConfig,
  lib: rslibConfig.lib?.map(lib => ({
    ...lib,
    dts:
      lib.id === 'esm-node'
        ? {
            ...ts7DtsConfig,
            autoExtension: true,
            distPath: './dist/types-esm',
          }
        : lib.dts,
    source: { ...lib.source, entry: { index: ['./src/**/*.ts'] } },
  })),
});
