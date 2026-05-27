import { appTools, defineConfig } from '@modern-js/app-tools';
import { i18nPlugin } from '@modern-js/plugin-i18n';
import { moduleFederationPlugin } from '@module-federation/modern-js-v3';

const enableAppLevelMFSSR = process.env.MODERN_MF_APP_SSR === 'true';
const enableFastTest = process.env.MODERN_FAST_TEST === 'true';

export default defineConfig({
  server: {
    ...(enableAppLevelMFSSR
      ? {
          ssr: {
            mode: 'stream',
            moduleFederationAppSSR: true,
          },
        }
      : {}),
    port: 3005,
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
          '/about',
          '/',
          '/custom',
          '/mf-manifest.json',
          '/mf-stats.json',
          '/remoteEntry.js',
        ],
      },
    }),
    moduleFederationPlugin(),
  ],
});
