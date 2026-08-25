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
        // `src/esm` is also matched by the `./src/**` entry, so the bundler
        // emits these files itself. The ESM outputs keep the `.mjs` extension,
        // which means bundle and copy write the very same paths — two writers
        // for one file, occasionally leaving it truncated and unparsable, which
        // takes down every `"type": "module"` project. The CJS output emits
        // `.js`, so there the copy is the only thing providing the `.mjs`
        // loaders that `register()` resolves by name; keep it for that alone.
        copy: [
          ...(libConfig.format === 'esm'
            ? []
            : [
                {
                  from: './src/esm',
                  to: './esm',
                },
              ]),
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
