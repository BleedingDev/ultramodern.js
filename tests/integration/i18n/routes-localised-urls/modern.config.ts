import { appTools, defineConfig } from '@modern-js/app-tools';
import { bffPlugin } from '@modern-js/plugin-bff';
import { i18nPlugin } from '@modern-js/plugin-i18n';
import { localisedUrls } from './src/localisedUrls';

export default defineConfig({
  server: {
    ssr: {
      mode: 'string',
    },
  },
  bff: {
    prefix: '/bff-api',
    runtimeFramework: 'effect',
    effect: {
      entry: './api/effect/index',
    },
  },
  performance: {
    buildCache: false,
  },
  plugins: [
    appTools(),
    bffPlugin(),
    i18nPlugin({
      reactI18next: false,
      localeDetection: {
        localePathRedirect: true,
        languages: ['en', 'cs'],
        fallbackLanguage: 'en',
        ignoreRedirectRoutes: ['/bff-api'],
        localisedUrls,
      },
    }),
  ],
});
