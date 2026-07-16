import {
  getLeadingLocaleParam,
  normalisePathPattern,
  normaliseRoutePath,
  stripLeadingLocaleParam,
} from './normalise';
import type {
  LocalisedRoute,
  LocalisedUrlPathMap,
  LocalisedUrlsMap,
} from './types';

const isLocalisableRoutePath = (path?: string): path is string => {
  const pathWithoutLocale = stripLeadingLocaleParam(path);

  if (
    !pathWithoutLocale ||
    pathWithoutLocale === '/' ||
    pathWithoutLocale === '*'
  ) {
    return false;
  }

  return true;
};

const joinPath = (parentPath: string, routePath?: string): string => {
  if (!isLocalisableRoutePath(routePath)) {
    return parentPath;
  }

  const segment = normaliseRoutePath(stripLeadingLocaleParam(routePath) || '');
  return normalisePathPattern(`${parentPath}/${segment}`);
};

const isFrameworkInternalRoutePath = (canonicalPath: string) =>
  canonicalPath === '/_mf' || canonicalPath.startsWith('/_mf/');

const ensureLocalisedUrlsForPath = (
  canonicalPath: string,
  languages: string[],
  localisedUrls: LocalisedUrlsMap,
): LocalisedUrlPathMap => {
  const entry = localisedUrls[canonicalPath];
  if (!entry) {
    throw new Error(
      `localisedUrls is enabled, but route "${canonicalPath}" does not define localised URLs for languages: ${languages.join(
        ', ',
      )}. Add localisedUrls["${canonicalPath}"] or set localeDetection.localisedUrls to false.`,
    );
  }

  const missingLanguages = languages.filter(language => !entry[language]);
  if (missingLanguages.length > 0) {
    throw new Error(
      `localisedUrls["${canonicalPath}"] is missing languages: ${missingLanguages.join(
        ', ',
      )}. Every configured language must have a localised URL.`,
    );
  }

  return entry;
};

export const validateLocalisedUrls = (
  routes: LocalisedRoute[],
  languages: string[],
  localisedUrls: LocalisedUrlsMap,
) => {
  const visit = (route: LocalisedRoute, parentPath: string) => {
    const canonicalPath = joinPath(parentPath, route.path);
    if (
      isLocalisableRoutePath(route.path) &&
      !isFrameworkInternalRoutePath(canonicalPath)
    ) {
      ensureLocalisedUrlsForPath(canonicalPath, languages, localisedUrls);
    }

    if ('children' in route && route.children) {
      route.children.forEach(child => visit(child, canonicalPath));
    }
  };

  routes.forEach(route => visit(route, ''));
};

const getLocalisedRoutePaths = (
  canonicalPath: string,
  parentLocalisedPaths: Record<string, string>,
  languages: string[],
  entry: LocalisedUrlPathMap,
): string[] => {
  const paths = languages.map(language => {
    const fullPath = normalisePathPattern(entry[language]);
    const parentPath = normalisePathPattern(
      parentLocalisedPaths[language] || '/',
    );
    if (parentPath === '/') {
      return normaliseRoutePath(fullPath) || undefined;
    }

    const parentPrefix = `${parentPath}/`;
    if (!fullPath.startsWith(parentPrefix)) {
      throw new Error(
        `localisedUrls["${canonicalPath}"].${language} must be nested under "${parentPath}" because its parent route is localised there.`,
      );
    }

    return normaliseRoutePath(fullPath.slice(parentPath.length));
  });

  return Array.from(new Set(paths.filter(Boolean) as string[]));
};

const transformLocalisedRoute = (
  route: LocalisedRoute,
  parentCanonicalPath: string,
  parentLocalisedPaths: Record<string, string>,
  languages: string[],
  localisedUrls: LocalisedUrlsMap,
): LocalisedRoute[] => {
  const canonicalPath = joinPath(parentCanonicalPath, route.path);
  const localisedUrlEntry =
    isLocalisableRoutePath(route.path) &&
    !isFrameworkInternalRoutePath(canonicalPath)
      ? ensureLocalisedUrlsForPath(canonicalPath, languages, localisedUrls)
      : undefined;
  const routeLocalisedPaths = localisedUrlEntry
    ? languages.reduce<Record<string, string>>((acc, language) => {
        acc[language] = normalisePathPattern(localisedUrlEntry[language]);
        return acc;
      }, {})
    : parentLocalisedPaths;

  const children =
    'children' in route && route.children
      ? route.children.flatMap(child =>
          transformLocalisedRoute(
            child,
            canonicalPath,
            routeLocalisedPaths,
            languages,
            localisedUrls,
          ),
        )
      : undefined;

  const baseRoute = {
    ...route,
    ...(children ? { children } : {}),
  } as LocalisedRoute;

  if (!localisedUrlEntry) {
    return [baseRoute];
  }

  return getLocalisedRoutePaths(
    canonicalPath,
    parentLocalisedPaths,
    languages,
    localisedUrlEntry,
  ).map((localisedPath, index) =>
    cloneRouteWithLocalisedPath(baseRoute, localisedPath, index, canonicalPath),
  );
};

const legalRouteIdPart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_$-]+/g, '_').replace(/^_+|_+$/g, '') || 'index';

const suffixRouteIds = <T extends LocalisedRoute>(
  route: T,
  suffix: string,
): T => {
  const children =
    'children' in route && route.children
      ? route.children.map(child => suffixRouteIds(child, suffix))
      : undefined;

  return {
    ...route,
    ...(route.id ? { id: `${route.id}__localised_${suffix}` } : {}),
    ...(children ? { children } : {}),
  };
};

const cloneRouteWithLocalisedPath = (
  route: LocalisedRoute,
  path: string,
  index: number,
  canonicalPath: string,
): LocalisedRoute => {
  const leadingLocaleParam = getLeadingLocaleParam(route.path);
  const localisedPath = leadingLocaleParam
    ? normaliseRoutePath(`${leadingLocaleParam}/${path}`)
    : path;
  const routeWithPath = {
    ...route,
    path: localisedPath,
  } as LocalisedRoute;
  // Language-agnostic source pattern; lets downstream codegen collapse the
  // localized physical variants back to one canonical route.
  (routeWithPath as { modernCanonicalPath?: string }).modernCanonicalPath =
    canonicalPath;

  return index === 0
    ? routeWithPath
    : suffixRouteIds(routeWithPath, legalRouteIdPart(localisedPath));
};

export const applyLocalisedUrlsToRoutes = (
  routes: LocalisedRoute[],
  languages: string[],
  localisedUrls: LocalisedUrlsMap,
): LocalisedRoute[] => {
  const rootLocalisedPaths = languages.reduce<Record<string, string>>(
    (acc, language) => {
      acc[language] = '/';
      return acc;
    },
    {},
  );

  validateLocalisedUrls(routes, languages, localisedUrls);

  return routes.flatMap(route =>
    transformLocalisedRoute(
      route,
      '',
      rootLocalisedPaths,
      languages,
      localisedUrls,
    ),
  );
};
