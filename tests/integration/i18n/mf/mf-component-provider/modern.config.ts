import { appTools, defineConfig } from '@modern-js/app-tools';
import { i18nPlugin } from '@modern-js/plugin-i18n';
import { moduleFederationPlugin } from '@module-federation/modern-js-v3';

const enableFastTest = process.env.MODERN_FAST_TEST === 'true';

export default defineConfig({
  server: {
    ssr: {
      mode: 'stream',
    },
    port: 3006,
  },
  performance: {
    buildCache: false,
    ...(enableFastTest
      ? {
          rsdoctor: false,
        }
      : {}),
  },
  output: enableFastTest
    ? {
        disableTsChecker: true,
      }
    : undefined,
  source: {
    define: {
      REMOTE_IP_STRATEGY: JSON.stringify('inherit'),
    },
  },
  plugins: [
    appTools(),
    i18nPlugin({
      localeDetection: {
        localePathRedirect: true,
        languages: ['zh', 'en'],
        fallbackLanguage: 'en',
        localisedUrls: false,
        ignoreRedirectRoutes: [
          '/mf-manifest.json',
          '/mf-stats.json',
          '/remoteEntry.js',
        ],
      },
    }),
    moduleFederationPlugin(),
  ],
});
