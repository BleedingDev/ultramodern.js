import { appTools, defineConfig } from '@modern-js/app-tools';
import { bffPlugin } from '@modern-js/plugin-bff';
import { moduleFederationPlugin } from '@module-federation/modern-js-v3';

export default defineConfig({
  server: {
    port: 3011,
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
    prefix: '/host-api',
    runtimeFramework: 'effect',
    effect: {
      openapi: true,
    },
  },
  plugins: [appTools(), bffPlugin(), moduleFederationPlugin()],
});
