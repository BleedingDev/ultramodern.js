import { ts7DtsConfig } from '@modern-js/rslib';
import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      dts: ts7DtsConfig,
      bundle: false,
      syntax: 'es2021',
    },
  ],
});
