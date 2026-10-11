import { rslibConfig } from '@modern-js/rslib';
import { defineConfig } from '@rslib/core';
import { publicDeclarationsPlugin } from '../../../scripts/prebundle/ultramodern/public-declarations.mjs';

export default defineConfig({
  ...rslibConfig,
  plugins: [
    ...(rslibConfig.plugins ?? []),
    publicDeclarationsPlugin('app-tools-extensions'),
  ],
  lib: rslibConfig.lib?.map(libConfig => ({
    ...libConfig,
    source: {
      ...libConfig.source,
      entry: {
        index: ['./src/**/*.ts', './src/release-envelope/contract.mjs'],
      },
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
