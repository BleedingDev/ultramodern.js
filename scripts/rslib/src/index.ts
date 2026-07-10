import { pluginReact } from '@rsbuild/plugin-react';
import type { RslibConfig } from '@rslib/core';

export const RSLIB_CODE_ENTRY_GLOB =
  './src/**/*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}';

export const rslibConfig: RslibConfig = {
  plugins: [pluginReact()],
  performance: {
    buildCache: false,
  },
  lib: [
    {
      id: 'esm-node',
      format: 'esm' as const,
      syntax: 'es2021' as const,
      bundle: false,
      outBase: './src',
      autoExtension: true,
      output: {
        distPath: {
          root: './dist/esm-node',
        },
        target: 'node' as const,
      },
      dts: false,
      source: {
        entry: {
          index: [RSLIB_CODE_ENTRY_GLOB],
        },
        define: {
          'process.env.MODERN_LIB_FORMAT': '"esm"',
        },
      },
      shims: {
        esm: {
          require: true,
          __dirname: true,
          __filename: true,
        },
      },
    },
    {
      id: 'esm-web',
      format: 'esm' as const,
      syntax: 'es2021' as const,
      bundle: false,
      outBase: './src',
      source: {
        entry: {
          index: [RSLIB_CODE_ENTRY_GLOB],
        },
        define: {
          'process.env.MODERN_LIB_FORMAT': '"esm"',
        },
      },
      autoExtension: true,
      output: {
        distPath: {
          root: './dist/esm',
        },
        target: 'web' as const,
      },
      dts: false,
    },
    {
      id: 'cjs-node',
      format: 'cjs' as const,
      syntax: 'es2021' as const,
      bundle: false,
      outBase: './src',
      output: {
        distPath: {
          root: './dist/cjs',
        },
        target: 'node' as const,
      },
      source: {
        entry: {
          index: [RSLIB_CODE_ENTRY_GLOB],
        },
        define: {
          'process.env.MODERN_LIB_FORMAT': '"cjs"',
        },
      },
    },
  ],
};
