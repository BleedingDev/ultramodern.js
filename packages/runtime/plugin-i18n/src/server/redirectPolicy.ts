import { localiseTargetPathname } from '../shared/localisedUrls.js';
import type { LocaleDetectionOptions } from '../shared/type';

/**
 * Check if the given pathname should ignore automatic locale redirect
 */
export const shouldIgnoreRedirect = (
  pathname: string,
  urlPath: string,
  ignoreRedirectRoutes?: string[] | ((pathname: string) => boolean),
): boolean => {
  if (!ignoreRedirectRoutes) {
    return false;
  }

  // Remove urlPath prefix to get remaining path for matching
  const basePath = urlPath.replace('/*', '');
  const remainingPath = pathname.startsWith(basePath)
    ? pathname.slice(basePath.length)
    : pathname;

  // Normalize path (ensure it starts with /)
  const normalizedPath = remainingPath.startsWith('/')
    ? remainingPath
    : `/${remainingPath}`;

  if (typeof ignoreRedirectRoutes === 'function') {
    return ignoreRedirectRoutes(normalizedPath);
  }

  // Check if pathname matches any of the ignore patterns
  return ignoreRedirectRoutes.some(pattern => {
    // Support both exact match and prefix match
    return (
      normalizedPath === pattern || normalizedPath.startsWith(`${pattern}/`)
    );
  });
};

/**
 * Check if the given pathname is a static resource request
 * This includes:
 * 1. Paths matching staticRoutePrefixes (from public directories)
 * 2. Standard static resource paths like /static/, /upload/
 * 3. Paths with language prefix like /en/static/, /zh/static/
 */
export const isStaticResourceRequest = (
  pathname: string,
  staticRoutePrefixes: string[],
  languages: string[] = [],
): boolean => {
  // Check against staticRoutePrefixes (from public directories)
  if (
    staticRoutePrefixes.some(
      prefix => pathname.startsWith(`${prefix}/`) || pathname === prefix,
    )
  ) {
    return true;
  }

  // Check standard static resource paths
  const standardStaticPrefixes = ['/static/', '/upload/'];
  if (standardStaticPrefixes.some(prefix => pathname.startsWith(prefix))) {
    return true;
  }

  // Check paths with language prefix (e.g., /en/static/, /zh/static/)
  // Remove language prefix if present and check again
  const pathSegments = pathname.split('/').filter(Boolean);
  if (pathSegments.length > 0 && languages.includes(pathSegments[0])) {
    const pathWithoutLang = '/' + pathSegments.slice(1).join('/');
    if (
      standardStaticPrefixes.some(prefix =>
        pathWithoutLang.startsWith(prefix),
      ) ||
      staticRoutePrefixes.some(
        prefix =>
          pathWithoutLang.startsWith(`${prefix}/`) ||
          pathWithoutLang === prefix,
      )
    ) {
      return true;
    }
  }

  return false;
};

export const getLanguageFromPath = (
  req: any,
  urlPath: string,
  languages: string[],
): string | null => {
  const url = new URL(req.url, `http://${req.header().host}`);
  const pathname = url.pathname;

  // Remove urlPath prefix to get remaining path
  // urlPath format is /lang/*, need to remove /lang part
  const basePath = urlPath.replace('/*', '');
  const remainingPath = pathname.startsWith(basePath)
    ? pathname.slice(basePath.length)
    : pathname;

  const segments = remainingPath.split('/').filter(Boolean);
  const firstSegment = segments[0];

  if (languages.includes(firstSegment)) {
    return firstSegment;
  }

  return null;
};

export const buildLocalizedUrl = (
  req: any,
  urlPath: string,
  language: string,
  languages: string[],
  localisedUrls?: LocaleDetectionOptions['localisedUrls'],
): string => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Remove urlPath prefix to get remaining path
  const basePath = urlPath.replace('/*', '');
  const remainingPath = pathname.startsWith(basePath)
    ? pathname.slice(basePath.length)
    : pathname;

  const newPathname = localiseTargetPathname(
    remainingPath,
    language,
    languages,
    localisedUrls,
  );
  // Handle root path case to avoid double slashes like //en
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
