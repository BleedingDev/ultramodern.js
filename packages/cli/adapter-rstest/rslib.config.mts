import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      dts: false,
      bundle: false,
      syntax: 'es2021',
    },
  ],
});
