import { defineConfig } from '@rslib/core';

// This package contains plain TypeScript lifecycle bindings. Application view
// source and the native router dependency are compiled by the selected adapter.
// Keep library compilation independent of the monorepo's React preset.
export default defineConfig({
  performance: { buildCache: false },
  lib: [
    {
      format: 'esm',
      syntax: 'es2021',
      bundle: false,
      outBase: './src',
      autoExtension: true,
      source: { entry: { index: ['./src/**/*.ts', '!./src/typecheck.ts'] } },
      output: { distPath: { root: './dist/esm' }, target: 'web' },
      dts: false,
    },
    {
      format: 'esm',
      syntax: 'es2021',
      bundle: false,
      outBase: './src',
      autoExtension: true,
      source: { entry: { typecheck: './src/typecheck.ts' } },
      output: { distPath: { root: './dist/esm-node' }, target: 'node' },
      dts: false,
    },
    {
      format: 'cjs',
      syntax: 'es2021',
      bundle: false,
      outBase: './src',
      source: { entry: { index: ['./src/**/*.ts'] } },
      output: { distPath: { root: './dist/cjs' }, target: 'node' },
      dts: false,
    },
  ],
});
