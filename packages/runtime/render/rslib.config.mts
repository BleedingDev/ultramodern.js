import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: 'es2021',
      bundle: true,
      dts: false,
      source: {
        entry: {
          ssr: './src/ssr.ts',
          rsc: './src/rsc.ts',
          client: './src/client.ts',
        },
      },
      output: {
        distPath: {
          root: './dist/esm',
        },
        target: 'web',
      },
    },
  ],
});
