import { rslibConfig } from '@modern-js/rslib';
import { defineConfig } from '@rslib/core';

const APP_TOOLS_CODE_ENTRY_GLOBS = [
  './src/**/*.{js,jsx,ts,tsx,mts,cts}',
  './src/esm/*.mjs',
];

export default defineConfig({
  ...rslibConfig,
  lib: rslibConfig.lib?.map(libConfig => {
    return {
      ...libConfig,
      source: {
        ...libConfig.source,
        entry: {
          // Deploy templates are copy-only; `src/esm` still needs compiled CJS.
          index: APP_TOOLS_CODE_ENTRY_GLOBS,
        },
      },
      output: {
        ...libConfig.output,
        copy: [
          {
            from: './src/esm',
            to: './esm',
          },
          {
            from: './src/plugins/deploy/platforms/templates',
            to: './plugins/deploy/platforms/templates',
            // These JavaScript-named assets must bypass Rspack's minimizer.
            info: { minimized: true },
          },
        ],
      },
    };
  }),
});
