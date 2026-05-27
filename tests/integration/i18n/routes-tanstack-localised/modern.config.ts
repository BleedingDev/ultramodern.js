import { appTools, defineConfig } from '@modern-js/app-tools';
import { bffPlugin } from '@modern-js/plugin-bff';
import { i18nPlugin } from '@modern-js/plugin-i18n';
import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';

const localisedUrls = {
  '/terms-of-service': {
    en: '/terms-of-service',
    cs: '/obchodni-podminky',
  },
  '/link-probe': {
    en: '/link-probe',
    cs: '/odkaz-probe',
  },
  '/products': {
    en: '/products',
    cs: '/produkty',
  },
  '/products/:slug': {
    en: '/products/:slug',
    cs: '/produkty/:slug',
  },
  '/optional': {
    en: '/optional',
    cs: '/volitelne',
  },
  '/optional/:slug?': {
    en: '/optional/:slug?',
    cs: '/volitelne/:slug?',
  },
};

export default defineConfig({
  plugins: [
    appTools(),
    tanstackRouterPlugin(),
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
    bffPlugin(),
  ],
  output: {
    polyfill: 'off',
    disableTsChecker: true,
    minify: false,
  },
  server: {
    ssr: {
      mode: 'string',
    },
  },
  bff: {
    prefix: '/bff-api',
    runtimeFramework: 'hono',
  },
  performance: {
    buildCache: false,
  },
});
