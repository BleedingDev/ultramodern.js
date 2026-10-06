import { rslibConfig } from '@modern-js/rslib';
import { defineConfig } from '@rslib/core';

export default defineConfig({
  ...rslibConfig,
  source: {
    define: {
      WEBPACK_CHUNK_LOAD: '__webpack_chunk_load__',
    },
  },
  output: {
    externals: [
      // Keep the package self-reference in the output: Module Federation
      // shares the runtime contexts by that request.
      '@modern-js/runtime/context',
      {
        '@modern-js/runtime-utils/node$':
          'commonjs @modern-js/runtime-utils/node',
      },
    ],
  },
});
