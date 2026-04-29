import { appTools, defineConfig } from '@modern-js/app-tools';
import { bffPlugin } from '@modern-js/plugin-bff';
import { moduleFederationPlugin } from '@module-federation/modern-js-v3';

export default defineConfig({
  tools: {
    devServer: {
      headers: {
        'Access-Control-Allow-Headers':
          'Accept, Authorization, Content-Type, X-Requested-With',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Origin': 'http://localhost:3011',
      },
    },
  },
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
      openapi: {
        path: '/openapi.json',
      },
    },
  },
  plugins: [appTools(), bffPlugin(), moduleFederationPlugin()],
});
