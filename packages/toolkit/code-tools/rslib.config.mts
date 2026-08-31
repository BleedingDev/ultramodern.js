import { rslibConfig } from '@modern-js/rslib';
import { defineConfig } from '@rslib/core';

export default defineConfig({
  ...rslibConfig,
  lib: rslibConfig.lib.map(config =>
    config.dts
      ? {
          ...config,
          redirect: {
            ...config.redirect,
            dts: { ...config.redirect?.dts, extension: true },
          },
        }
      : config,
  ),
});
