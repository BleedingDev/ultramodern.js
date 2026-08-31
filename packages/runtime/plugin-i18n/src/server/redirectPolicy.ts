import {
  isDefaultLocaleRedirectSkipPath,
  localiseTargetPathname,
  matchesPathPrefix,
  shouldSkipLocaleRedirect,
  stripLanguagePrefix,
} from '@modern-js/i18n-runtime-extensions';
import type { LocaleDetectionOptions } from '../shared/type';

interface LocaleRedirectRequest {
  url: string;
  header: () => {
    host?: string;
  };
}

const stripUrlPathPrefix = (pathname: string, urlPath: string): string => {
  const basePath = urlPath.replace('/*', '');

  if (!basePath || basePath === '/') {
    return pathname;
  }

  const remainingPath = pathname.startsWith(basePath)
    ? pathname.slice(basePath.length)
    : pathname;

  return remainingPath || '/';
};

/**
 * Check if pathname should ignore automatic locale redirect.
 */
export const shouldIgnoreRedirect = (
  pathname: string,
  urlPath: string,
  ignoreRedirectRoutes?: string[] | ((pathname: string) => boolean),
): boolean => {
  const remainingPath = stripUrlPathPrefix(pathname, urlPath);

  return shouldSkipLocaleRedirect(remainingPath, [], ignoreRedirectRoutes);
};

/**
 * Check if pathname is a static or federation resource request.
 *
 * This includes configured staticRoutePrefixes, the shared default skip policy
 * from ADR-0002, and language-prefixed variants such as /en/static/app.js.
 */
export const isStaticResourceRequest = (
  pathname: string,
  staticRoutePrefixes: string[],
  languages: string[] = [],
): boolean => {
  if (isDefaultLocaleRedirectSkipPath(pathname, languages)) {
    return true;
  }

  const matchesStaticRoutePrefix = (targetPathname: string): boolean =>
    staticRoutePrefixes.some(prefix =>
      matchesPathPrefix(targetPathname, prefix),
    );

  if (matchesStaticRoutePrefix(pathname)) {
    return true;
  }

  const pathWithoutLanguage = stripLanguagePrefix(pathname, languages);

  return (
    pathWithoutLanguage !== pathname &&
    matchesStaticRoutePrefix(pathWithoutLanguage)
  );
};

export const getLanguageFromPath = (
  req: LocaleRedirectRequest,
  urlPath: string,
  languages: string[],
): string | null => {
  const url = new URL(req.url, `http://${req.header().host}`);
  const pathname = url.pathname;
  const remainingPath = stripUrlPathPrefix(pathname, urlPath);
  const segments = remainingPath.split('/').filter(Boolean);
  const firstSegment = segments[0];

  if (languages.includes(firstSegment)) {
    return firstSegment;
  }

  return null;
};

export const buildLocalizedUrl = (
  req: LocaleRedirectRequest,
  urlPath: string,
  language: string,
  languages: string[],
  localisedUrls?: LocaleDetectionOptions['localisedUrls'],
): string => {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const basePath = urlPath.replace('/*', '');
  const remainingPath = stripUrlPathPrefix(pathname, urlPath);

  const newPathname = localiseTargetPathname(
    remainingPath,
    language,
    languages,
    localisedUrls,
  );
  const suffix = `${url.search}${url.hash}`;
  const localizedUrl =
    basePath === '/' ? newPathname + suffix : basePath + newPathname + suffix;

  return localizedUrl;
};

export const createLocaleRedirectResponse = (location: string): Response =>
  new Response(null, {
    status: 302,
    headers: {
      'Cache-Control': 'private, no-store',
      Location: location,
      Vary: 'Accept-Language, Cookie',
    },
  });
