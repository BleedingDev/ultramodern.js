import type { NestedRouteForCli, PageRoute } from '@modern-js/types';

export type LocalisedUrlPathMap = Record<string, string>;
export type LocalisedUrlsMap = Record<string, LocalisedUrlPathMap>;
export type LocalisedUrlsOption = boolean | LocalisedUrlsMap;

export interface ResolvedLocalisedUrlsConfig {
  enabled: boolean;
  map: LocalisedUrlsMap;
}

const LOCALE_PARAM_NAMES = new Set(['lang', 'locale', 'language']);

export const normalisePathPattern = (path: string): string => {
  const withoutDuplicateSlashes = path.replace(/\/+/g, '/');
  const withLeadingSlash = withoutDuplicateSlashes.startsWith('/')
    ? withoutDuplicateSlashes
    : `/${withoutDuplicateSlashes}`;
  const withoutTrailingSlash =
    withLeadingSlash.length > 1
      ? withLeadingSlash.replace(/\/+$/, '')
      : withLeadingSlash;

  return withoutTrailingSlash.replace(/\[(.+?)\]/g, ':$1');
};

const normaliseRoutePath = (path: string): string => {
  const normalized = normalisePathPattern(path);
  return normalized === '/' ? '' : normalized.slice(1);
};

export const resolveLocalisedUrlsConfig = (
  option: LocalisedUrlsOption | undefined,
): ResolvedLocalisedUrlsConfig => {
  if (option === false) {
    return { enabled: false, map: {} };
  }

  if (option && typeof option === 'object') {
    return { enabled: true, map: option };
  }

  return { enabled: true, map: {} };
};

const isLocaleParamPath = (path?: string): boolean => {
  if (!path) {
    return false;
  }

  const normalized = path.replace(/^\//, '');
  if (!normalized.startsWith(':')) {
    return false;
  }

  return LOCALE_PARAM_NAMES.has(normalized.slice(1));
};

const isLocalisableRoutePath = (path?: string): path is string => {
  if (!path || path === '/' || path === '*') {
    return false;
  }

  return !isLocaleParamPath(path);
};

const joinPath = (parentPath: string, routePath?: string): string => {
  if (!isLocalisableRoutePath(routePath)) {
    return parentPath;
  }

  const segment = normaliseRoutePath(routePath);
  return normalisePathPattern(`${parentPath}/${segment}`);
};

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
  routes: (NestedRouteForCli | PageRoute)[],
  languages: string[],
  localisedUrls: LocalisedUrlsMap,
) => {
  const visit = (route: NestedRouteForCli | PageRoute, parentPath: string) => {
    const canonicalPath = joinPath(parentPath, route.path);
    if (isLocalisableRoutePath(route.path)) {
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
  localisedUrls: LocalisedUrlsMap,
): string[] => {
  const entry = ensureLocalisedUrlsForPath(
    canonicalPath,
    languages,
    localisedUrls,
  );
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
  route: NestedRouteForCli | PageRoute,
  parentCanonicalPath: string,
  parentLocalisedPaths: Record<string, string>,
  languages: string[],
  localisedUrls: LocalisedUrlsMap,
): (NestedRouteForCli | PageRoute)[] => {
  const canonicalPath = joinPath(parentCanonicalPath, route.path);
  const routeLocalisedPaths = isLocalisableRoutePath(route.path)
    ? languages.reduce<Record<string, string>>((acc, language) => {
        acc[language] = normalisePathPattern(
          ensureLocalisedUrlsForPath(canonicalPath, languages, localisedUrls)[
            language
          ],
        );
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
  } as NestedRouteForCli | PageRoute;

  if (!isLocalisableRoutePath(route.path)) {
    return [baseRoute];
  }

  return getLocalisedRoutePaths(
    canonicalPath,
    parentLocalisedPaths,
    languages,
    localisedUrls,
  ).map((localisedPath, index) =>
    cloneRouteWithLocalisedPath(baseRoute, localisedPath, index),
  );
};

const legalRouteIdPart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_$-]+/g, '_').replace(/^_+|_+$/g, '') || 'index';

const suffixRouteIds = <T extends NestedRouteForCli | PageRoute>(
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
  route: NestedRouteForCli | PageRoute,
  path: string,
  index: number,
): NestedRouteForCli | PageRoute => {
  const routeWithPath = {
    ...route,
    path,
  } as NestedRouteForCli | PageRoute;

  return index === 0
    ? routeWithPath
    : suffixRouteIds(routeWithPath, legalRouteIdPart(path));
};

export const applyLocalisedUrlsToRoutes = (
  routes: (NestedRouteForCli | PageRoute)[],
  languages: string[],
  localisedUrls: LocalisedUrlsMap,
): (NestedRouteForCli | PageRoute)[] => {
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

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const compilePathPattern = (pattern: string) => {
  const names: string[] = [];
  const segments = normalisePathPattern(pattern).split('/').filter(Boolean);
  const source = segments
    .map(segment => {
      if (segment.startsWith(':')) {
        names.push(segment.slice(1));
        return '([^/]+)';
      }
      if (segment === '*') {
        names.push('*');
        return '(.*)';
      }
      return escapeRegExp(segment);
    })
    .join('/');

  return {
    names,
    regexp: new RegExp(`^/${source}$`),
  };
};

const matchPathPattern = (
  pathname: string,
  pattern: string,
): Record<string, string> | null => {
  const { names, regexp } = compilePathPattern(pattern);
  const match = regexp.exec(normalisePathPattern(pathname));
  if (!match) {
    return null;
  }

  return names.reduce<Record<string, string>>((params, name, index) => {
    params[name] = decodeURIComponent(match[index + 1] || '');
    return params;
  }, {});
};

const buildPathFromPattern = (
  pattern: string,
  params: Record<string, string>,
): string => {
  const segments = normalisePathPattern(pattern).split('/').filter(Boolean);
  const path = segments
    .map(segment => {
      if (segment.startsWith(':')) {
        return encodeURIComponent(params[segment.slice(1)] || '');
      }
      if (segment === '*') {
        return params['*'] || '';
      }
      return segment;
    })
    .filter(Boolean)
    .join('/');

  return `/${path}`;
};

export const resolveLocalisedPath = (
  pathname: string,
  targetLanguage: string,
  languages: string[],
  localisedUrls: LocalisedUrlsMap,
): string => {
  const normalizedPathname = normalisePathPattern(pathname);

  for (const localisedUrlEntry of Object.values(localisedUrls)) {
    const targetPattern = localisedUrlEntry[targetLanguage];
    if (!targetPattern) {
      continue;
    }

    for (const language of languages) {
      const sourcePattern = localisedUrlEntry[language];
      if (!sourcePattern) {
        continue;
      }

      const params = matchPathPattern(normalizedPathname, sourcePattern);
      if (params) {
        return buildPathFromPattern(targetPattern, params);
      }
    }
  }

  return normalizedPathname;
};
