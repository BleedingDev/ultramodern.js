import { defineConfig } from '@rslib/core';

const sharedConfig = {
  format: 'esm' as const,
  syntax: 'es2021' as const,
  bundle: true,
  dts: false,
  output: {
    distPath: {
      root: './dist/esm',
    },
    target: 'web' as const,
  },
};

export default defineConfig({
  lib: [
    {
      ...sharedConfig,
      source: {
        entry: {
          ssr: './src/ssr.ts',
        },
      },
    },
    {
      ...sharedConfig,
      source: {
        entry: {
          rsc: './src/rsc.ts',
        },
      },
    },
    {
      ...sharedConfig,
      source: {
        entry: {
          client: './src/client.ts',
        },
      },
    },
  ],
});
