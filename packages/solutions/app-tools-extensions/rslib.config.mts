import { rslibConfig } from '@modern-js/rslib';
import { defineConfig } from '@rslib/core';

export default defineConfig({
  ...rslibConfig,
  lib: rslibConfig.lib?.map(libConfig => ({
    ...libConfig,
    source: {
      ...libConfig.source,
      entry: { index: ['./src/**/*.ts'] },
    },
    output: {
      ...libConfig.output,
      copy: [
        {
          from: './src/templates',
          to: './templates',
          info: { minimized: true },
        },
      ],
    },
  })),
});
