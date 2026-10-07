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
      source: {
        entry: {
          index: ['./src/**/*.ts', '!./src/typecheck.ts', '!./src/plugin/**'],
        },
      },
      output: { distPath: { root: './dist/esm' }, target: 'web' },
      dts: false,
    },
    {
      format: 'esm',
      syntax: 'es2021',
      bundle: false,
      outBase: './src',
      autoExtension: true,
      // Build-side entries: the typecheck CLI and the renderer adapter with
      // the manifest validator it shares with the runtime.
      source: {
        entry: {
          index: [
            './src/typecheck.ts',
            './src/plugin/**/*.ts',
            './src/manifest.ts',
            './src/bootstrap.ts',
          ],
        },
      },
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
