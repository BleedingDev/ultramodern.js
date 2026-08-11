import { appTools, defineConfig } from '@modern-js/app-tools';
import { getBuildConfigEnvironment } from '@modern-js/app-tools/config';
import { bffPlugin } from '@modern-js/plugin-bff';
import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';
import { moduleFederationPlugin } from '@module-federation/modern-js-v3';

const remotePort = Number(process.env.MF_REMOTE_PORT ?? 3010);
const hostOrigin = process.env.MF_HOST_ORIGIN ?? 'http://localhost:3011';
const isCloudflareBuild =
  getBuildConfigEnvironment('MODERNJS_DEPLOY') === 'cloudflare';

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
    ssr: {
      mode: 'stream',
      moduleFederationAppSSR: true,
    },
  },
  ...(isCloudflareBuild
    ? {
        deploy: {
          worker: {
            compatibilityDate: '2026-06-02',
            name: 'modernjs-routes-tanstack-mf-remote',
            ssr: true,
          },
        },
      }
    : {}),
  output: {
    polyfill: 'off',
    disableTsChecker: true,
    minify: isCloudflareBuild,
    ...(isCloudflareBuild
      ? {
          distPath: {
            root: 'dist-cloudflare',
          },
          splitRouteChunks: true,
          tempDir: 'node_modules/.modern-js-tanstack-mf-cloudflare',
        }
      : {}),
  },
  performance: {
    buildCache: false,
  },
  bff: {
    prefix: '/remote-api',
    runtimeFramework: 'effect',
    effect: {
      entry: isCloudflareBuild
        ? './api/effect/cloudflare'
        : './api/effect/index',
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
