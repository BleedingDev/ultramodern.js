import { appTools, defineConfig } from '@modern-js/app-tools';
import { bffPlugin } from '@modern-js/plugin-bff';
import { moduleFederationPlugin } from '@module-federation/modern-js-v3';

const remotePort = Number(process.env.MF_REMOTE_PORT ?? 3010);
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
    port: remotePort,
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
