import { resolveLocalisedUrlsConfig } from '@modern-js/i18n-runtime-extensions';
import * as honoPkg from '@modern-js/server-core/hono';

const { languageDetector } = honoPkg;

import type { Context, Next, ServerPlugin } from '@modern-js/server-runtime';
import type { LocaleDetectionOptions } from '../shared/type';
import { getLocaleDetectionOptions } from '../shared/utils.js';
import { collectApiPrefixes, matchesApiPrefix } from './apiPrefix.js';
import { convertToHonoLanguageDetectorOptions } from './detectorOptions.js';
import {
  buildLocalizedUrl,
  createLocaleRedirectResponse,
  getLanguageFromPath,
  isStaticResourceRequest,
  shouldIgnoreRedirect,
} from './redirectPolicy.js';

export { collectApiPrefixes, matchesApiPrefix } from './apiPrefix.js';

export interface I18nPluginOptions {
  localeDetection: LocaleDetectionOptions;
  staticRoutePrefixes: string[];
}

export const i18nServerPlugin = (options: I18nPluginOptions): ServerPlugin => ({
  name: '@modern-js/plugin-i18n/server',
  setup: api => {
    api.onPrepare(() => {
      const { middlewares, routes } = api.getServerContext();
      const serverConfig = api.getServerConfig();
      const bffPrefix = serverConfig?.bff
        ? (serverConfig.bff.prefix ?? '/api')
        : undefined;
      const apiPrefixes = collectApiPrefixes(routes, bffPrefix);

      // Collect all non-root entry paths for cross-entry path detection
      const entryPaths = new Set<string>();
      routes.forEach(route => {
        if (route.entryName && route.urlPath && route.urlPath !== '/') {
          const pathSegments = route.urlPath.split('/').filter(Boolean);
          if (pathSegments.length > 0) {
            entryPaths.add(`/${pathSegments[0]}`);
          }
        }
      });

      routes.map(route => {
        const { entryName } = route;
        if (!entryName) {
          return;
        }
        if (!options.localeDetection) {
          return;
        }
        const {
          localePathRedirect,
          i18nextDetector = true,
          languages = [],
          fallbackLanguage = 'en',
          detection,
          ignoreRedirectRoutes,
          localisedUrls,
        } = getLocaleDetectionOptions(entryName, options.localeDetection);
        const staticRoutePrefixes = options.staticRoutePrefixes;
        const originUrlPath = route.urlPath;
        const urlPath = originUrlPath.endsWith('/')
          ? `${originUrlPath}*`
          : `${originUrlPath}/*`;
        if (localePathRedirect) {
          // Add languageDetector middleware before the redirect handler
          if (i18nextDetector) {
            const detectorOptions = convertToHonoLanguageDetectorOptions(
              languages,
              fallbackLanguage,
              detection,
            );
            const detectorHandler = languageDetector(detectorOptions);
            middlewares.push({
              name: 'i18n-language-detector',
              path: urlPath,
              handler: async (c: Context, next: Next) => {
                const url = new URL(c.req.url);
                const pathname = url.pathname;

                if (matchesApiPrefix(pathname, apiPrefixes)) {
                  return await next();
                }

                // For static resource requests, skip language detection
                if (
                  isStaticResourceRequest(
                    pathname,
                    staticRoutePrefixes,
                    languages,
                  )
                ) {
                  return await next();
                }

                // If basePath is '/', check if path belongs to another entry
                if (originUrlPath === '/') {
                  const pathSegments = pathname.split('/').filter(Boolean);
                  if (pathSegments.length > 0) {
                    const firstSegment = `/${pathSegments[0]}`;
                    if (entryPaths.has(firstSegment)) {
                      return await next();
                    }
                  }
                }

                return detectorHandler(c, next);
              },
            });
          }

          middlewares.push({
            name: 'i18n-server-middleware',
            path: urlPath,
            handler: async (c: Context, next: Next) => {
              const url = new URL(c.req.url);
              const pathname = url.pathname;

              if (matchesApiPrefix(pathname, apiPrefixes)) {
                return await next();
              }

              // For static resource requests, skip i18n processing
              if (
                isStaticResourceRequest(
                  pathname,
                  staticRoutePrefixes,
                  languages,
                )
              ) {
                return await next();
              }

              // Check if this route should ignore automatic redirect
              if (
                shouldIgnoreRedirect(pathname, urlPath, ignoreRedirectRoutes)
              ) {
                return await next();
              }

              // If basePath is '/', check if path belongs to another entry
              if (originUrlPath === '/') {
                const pathSegments = pathname.split('/').filter(Boolean);
                if (pathSegments.length > 0) {
                  const firstSegment = `/${pathSegments[0]}`;
                  if (entryPaths.has(firstSegment)) {
                    return await next();
                  }
                }
              }

              const language = getLanguageFromPath(c.req, urlPath, languages);
              if (!language) {
                // Get detected language from languageDetector middleware
                let detectedLanguage: string | null = null;
                if (i18nextDetector) {
                  detectedLanguage = c.get('language') || null;
                }
                // Use detected language or fallback to fallbackLanguage
                const targetLanguage = detectedLanguage || fallbackLanguage;
                const localizedUrl = buildLocalizedUrl(
                  c.req,
                  originUrlPath,
                  targetLanguage,
                  languages,
                  localisedUrls,
                );
                return createLocaleRedirectResponse(localizedUrl);
              }
              const localisedUrlsConfig =
                resolveLocalisedUrlsConfig(localisedUrls);
              if (localisedUrlsConfig.enabled) {
                const expectedUrl = buildLocalizedUrl(
                  c.req,
                  originUrlPath,
                  language,
                  languages,
                  localisedUrls,
                );
                if (expectedUrl !== `${pathname}${url.search}${url.hash}`) {
                  return createLocaleRedirectResponse(expectedUrl);
                }
              }
              await next();
            },
          });
        }
      });
    });
  },
});

export default i18nServerPlugin;
