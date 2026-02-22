import { appTools, defineConfig } from '@modern-js/app-tools';
import { bffPlugin } from '@modern-js/plugin-bff';
import { moduleFederationPlugin } from '@module-federation/modern-js-v3';

export default defineConfig({
  server: {
    port: 3010,
  },
  output: {
    polyfill: 'off',
    disableTsChecker: true,
    minify: false,
  },
  performance: {
    buildCache: false,
  },
  bff: {
    prefix: '/remote-api',
    runtimeFramework: 'effect',
    effect: {
      openapi: {
        path: '/openapi.json',
      },
    },
  },
  plugins: [appTools(), bffPlugin(), moduleFederationPlugin()],
});
