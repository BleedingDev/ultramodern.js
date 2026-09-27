import { rslibConfig } from '@modern-js/rslib';
import { defineConfig } from '@rslib/core';

export default defineConfig({
  ...rslibConfig,
  // Keep `@modern-js/plugin-i18n/runtime/contexts` a package self-reference in
  // the output: Module Federation shares the i18n contexts by that request.
  lib: rslibConfig.lib.map(lib => ({
    ...lib,
    redirect: { ...lib.redirect, js: { ...lib.redirect?.js, path: false } },
  })),
});
