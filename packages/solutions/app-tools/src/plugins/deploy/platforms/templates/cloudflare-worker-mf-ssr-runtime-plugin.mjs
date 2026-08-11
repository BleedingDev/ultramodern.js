/**
 * Workerd cannot initialize Module Federation's Node-oriented SSR data-fetch
 * runtime. Cloudflare workers do not load native MF remotes, so retain the
 * runtime-plugin contract without installing its server data-fetch hooks.
 */
export const injectDataFetchFunctionPlugin = () => ({
  name: '@module-federation/inject-data-fetch-function-plugin',
  setup() {},
});

export const mfSSRDevPlugin = () => ({
  name: '@module-federation/modern-js-v3',
  setup() {},
});
