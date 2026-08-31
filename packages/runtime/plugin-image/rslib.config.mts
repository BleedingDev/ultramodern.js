import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: 'es2021',
      dts: false,
      source: {
        entry: { runtime: 'src/runtime.ts' },
      },
    },
    {
      format: 'cjs',
      syntax: 'es2021',
      dts: {
        abortOnError: true,
        bundle: false,
        distPath: './dist/types',
      },
      source: {
        entry: { index: 'src/cli.ts' },
      },
    },
  ],
});
