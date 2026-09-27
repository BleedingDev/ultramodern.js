import { rslibConfig } from '@modern-js/rslib';
import { defineConfig } from '@rslib/core';

export default defineConfig({
  ...rslibConfig,
  // Keep `@modern-js/runtime/context` a package self-reference in the output:
  // Module Federation shares the runtime contexts by that request.
  lib: rslibConfig.lib.map(lib => ({
    ...lib,
    redirect: { ...lib.redirect, js: { ...lib.redirect?.js, path: false } },
  })),
  source: {
    define: {
      WEBPACK_CHUNK_LOAD: '__webpack_chunk_load__',
    },
  },
  output: {
    externals: [
      {
        '@modern-js/runtime-utils/node$':
          'commonjs @modern-js/runtime-utils/node',
      },
    ],
  },
});
