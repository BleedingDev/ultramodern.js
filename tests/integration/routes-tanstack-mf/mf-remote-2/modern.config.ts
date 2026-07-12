import { appTools, defineConfig } from '@modern-js/app-tools';
import { bffPlugin } from '@modern-js/plugin-bff';
import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';
import { moduleFederationPlugin } from '@module-federation/modern-js-v3';

const remoteTwoPort = Number(process.env.MF_REMOTE_TWO_PORT ?? 3012);
const hostOrigin = process.env.MF_HOST_ORIGIN ?? 'http://localhost:3011';

export default defineConfig({
  tools: {
    devServer: {
      headers: {
        'Access-Control-Allow-Headers':
          'Accept, Authorization, Content-Type, X-Requested-With',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Origin': hostOrigin,
      },
    },
  },
  server: {
    port: remoteTwoPort,
    ssr: {
      mode: 'stream',
      moduleFederationAppSSR: true,
    },
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
    prefix: '/remote2-api',
    runtimeFramework: 'effect',
    effect: {
      entry: './api/effect/index',
      openapi: {
        path: '/openapi.json',
      },
    },
  },
  plugins: [
    appTools(),
    tanstackRouterPlugin(),
    bffPlugin(),
    moduleFederationPlugin(),
  ],
});
