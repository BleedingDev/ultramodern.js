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

const getLocaleParamSegment = (segment: string): string | null => {
  if (!segment.startsWith(':')) {
    return null;
  }

  const paramName = segment.slice(1).replace(/\?$/, '');
  return LOCALE_PARAM_NAMES.has(paramName) ? segment : null;
};

const splitPathSegments = (path?: string): string[] => {
  if (!path) {
    return [];
  }

  return normalisePathPattern(path).split('/').filter(Boolean);
};

const stripLeadingLocaleParam = (path?: string): string | undefined => {
  const segments = splitPathSegments(path);
  const leadingLocaleParam = getLocaleParamSegment(segments[0] || '');

  if (!leadingLocaleParam) {
    return path;
  }

  const remainingPath = segments.slice(1).join('/');
  return remainingPath ? `/${remainingPath}` : undefined;
};

const getLeadingLocaleParam = (path?: string): string | null => {
  const segments = splitPathSegments(path);
  return getLocaleParamSegment(segments[0] || '');
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
  const segments = splitPathSegments(path);
  return segments.length === 1 && Boolean(getLocaleParamSegment(segments[0]));
};

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
  route: NestedRouteForCli | PageRoute,
  parentCanonicalPath: string,
  parentLocalisedPaths: Record<string, string>,
  languages: string[],
  localisedUrls: LocalisedUrlsMap,
): (NestedRouteForCli | PageRoute)[] => {
  const canonicalPath = joinPath(parentCanonicalPath, route.path);
  const localisedUrlEntry = isLocalisableRoutePath(route.path)
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
  } as NestedRouteForCli | PageRoute;

  if (!localisedUrlEntry) {
    return [baseRoute];
  }

  return getLocalisedRoutePaths(
    canonicalPath,
    parentLocalisedPaths,
    languages,
    localisedUrlEntry,
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
  const leadingLocaleParam = getLeadingLocaleParam(route.path);
  const localisedPath = leadingLocaleParam
    ? normaliseRoutePath(`${leadingLocaleParam}/${path}`)
    : path;
  const routeWithPath = {
    ...route,
    path: localisedPath,
  } as NestedRouteForCli | PageRoute;

  return index === 0
    ? routeWithPath
    : suffixRouteIds(routeWithPath, legalRouteIdPart(localisedPath));
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

const getParamName = (segment: string): string =>
  segment.slice(1).replace(/\?$/, '');

const compilePathPattern = (pattern: string) => {
  const names: string[] = [];
  const segments = normalisePathPattern(pattern).split('/').filter(Boolean);
  const source = segments
    .map(segment => {
      if (segment.startsWith(':')) {
        names.push(getParamName(segment));
        const paramPattern = '([^/]+)';
        return segment.endsWith('?')
          ? `(?:/${paramPattern})?`
          : `/${paramPattern}`;
      }
      if (segment === '*') {
        names.push('*');
        return '/(.*)';
      }
      return `/${escapeRegExp(segment)}`;
    })
    .join('');

  return {
    names,
    regexp: new RegExp(`^${source || '/'}$`),
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
        const param = params[getParamName(segment)];
        return param ? encodeURIComponent(param) : '';
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
