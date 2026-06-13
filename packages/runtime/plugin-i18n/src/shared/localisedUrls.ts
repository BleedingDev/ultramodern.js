import type { NestedRouteForCli, PageRoute } from '@modern-js/types';

export type LocalisedUrlPathMap = Record<string, string>;
export type LocalisedUrlsMap = Record<string, LocalisedUrlPathMap>;
export type LocalisedUrlsOption = boolean | LocalisedUrlsMap;

export interface ResolvedLocalisedUrlsConfig {
  enabled: boolean;
  map: LocalisedUrlsMap;
}

const LOCALE_PARAM_NAMES = new Set(['lang', 'locale', 'language']);

const normaliseSlashes = (path: string): string => {
  const withoutDuplicateSlashes = path.replace(/\/+/g, '/');
  const withLeadingSlash = withoutDuplicateSlashes.startsWith('/')
    ? withoutDuplicateSlashes
    : `/${withoutDuplicateSlashes}`;

  return withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/+$/, '')
    : withLeadingSlash;
};

export const normalisePathPattern = (path: string): string =>
  normaliseSlashes(path).replace(/\[(.+?)\]/g, ':$1');

/**
 * Normalise a concrete request pathname: slash cleanup only. Unlike
 * {@link normalisePathPattern} it must not rewrite literal `[x]` segments to
 * `:x` params — pathnames are values, not patterns.
 */
export const normalisePathname = (pathname: string): string =>
  normaliseSlashes(pathname);

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

/**
 * Localised URLs are strictly opt-in: only an explicit, non-empty map enables
 * route expansion and validation. `true`, `false`, an empty map and absence
 * all resolve to disabled, so upstream-style configs (`localePathRedirect` +
 * `languages` without a map) keep plain locale-prefix behavior instead of
 * failing the build for every route missing from a map they never wrote.
 */
export const resolveLocalisedUrlsConfig = (
  option: LocalisedUrlsOption | undefined,
): ResolvedLocalisedUrlsConfig => {
  if (option && typeof option === 'object' && Object.keys(option).length > 0) {
    return { enabled: true, map: option };
  }

  return { enabled: false, map: {} };
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
    cloneRouteWithLocalisedPath(baseRoute, localisedPath, index, canonicalPath),
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
  canonicalPath: string,
): NestedRouteForCli | PageRoute => {
  const leadingLocaleParam = getLeadingLocaleParam(route.path);
  const localisedPath = leadingLocaleParam
    ? normaliseRoutePath(`${leadingLocaleParam}/${path}`)
    : path;
  const routeWithPath = {
    ...route,
    path: localisedPath,
  } as NestedRouteForCli | PageRoute;
  // Language-agnostic source pattern; lets downstream codegen collapse the
  // localized physical variants back to one canonical route.
  (routeWithPath as { modernCanonicalPath?: string }).modernCanonicalPath =
    canonicalPath;

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

interface CompiledPathPattern {
  names: string[];
  regexp: RegExp;
}

const compiledPathPatternCache = new Map<string, CompiledPathPattern>();

const compilePathPattern = (pattern: string): CompiledPathPattern => {
  const normalizedPattern = normalisePathPattern(pattern);
  const cached = compiledPathPatternCache.get(normalizedPattern);
  if (cached) {
    return cached;
  }

  const names: string[] = [];
  const segments = normalizedPattern.split('/').filter(Boolean);
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

  const compiled = {
    names,
    regexp: new RegExp(`^${source || '/'}$`),
  };
  compiledPathPatternCache.set(normalizedPattern, compiled);

  return compiled;
};

const getPatternSpecificity = (pattern: string) => {
  const segments = normalisePathPattern(pattern).split('/').filter(Boolean);
  let staticSegments = 0;
  let dynamicSegments = 0;
  let splatSegments = 0;

  for (const segment of segments) {
    if (segment === '*') {
      splatSegments++;
    } else if (segment.startsWith(':')) {
      dynamicSegments++;
    } else {
      staticSegments++;
    }
  }

  return {
    staticSegments,
    dynamicSegments,
    splatSegments,
    totalSegments: segments.length,
  };
};

const comparePatternSpecificity = (left: string, right: string): number => {
  const a = getPatternSpecificity(left);
  const b = getPatternSpecificity(right);

  return (
    b.staticSegments - a.staticSegments ||
    b.totalSegments - a.totalSegments ||
    a.splatSegments - b.splatSegments ||
    a.dynamicSegments - b.dynamicSegments
  );
};

const sortPatternsBySpecificity = <T extends { pattern: string }>(
  patterns: T[],
): T[] =>
  patterns
    .map((pattern, index) => ({ pattern, index }))
    .sort(
      (left, right) =>
        comparePatternSpecificity(
          left.pattern.pattern,
          right.pattern.pattern,
        ) || left.index - right.index,
    )
    .map(({ pattern }) => pattern);

/**
 * `decodeURIComponent` throws `URIError` on malformed percent-encoding
 * (e.g. `%E0%A4%A`), which attacker-controlled request URLs can carry.
 * Treat such segments as undecodable instead of throwing.
 */
const decodePathParam = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

export const matchPathPattern = (
  pathname: string,
  pattern: string,
): Record<string, string> | null => {
  const { names, regexp } = compilePathPattern(pattern);
  const match = regexp.exec(normalisePathname(pathname));
  if (!match) {
    return null;
  }

  const params: Record<string, string> = {};
  for (let index = 0; index < names.length; index++) {
    const decoded = decodePathParam(match[index + 1] || '');
    if (decoded === null) {
      // Malformed encoding cannot identify a localised route: no match.
      return null;
    }
    params[names[index]] = decoded;
  }

  return params;
};

export const buildPathFromPattern = (
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
  const normalizedPathname = normalisePathname(pathname);

  // Canonical keys take precedence: authors write language-agnostic paths,
  // which are the map keys, even when no language pattern equals the key.
  const canonicalCandidates = sortPatternsBySpecificity(
    Object.entries(localisedUrls).map(
      ([canonicalPattern, localisedUrlEntry]) => ({
        pattern: canonicalPattern,
        canonicalPattern,
        localisedUrlEntry,
      }),
    ),
  );

  for (const { canonicalPattern, localisedUrlEntry } of canonicalCandidates) {
    const targetPattern = localisedUrlEntry[targetLanguage];
    if (!targetPattern) {
      continue;
    }

    const params = matchPathPattern(normalizedPathname, canonicalPattern);
    if (params) {
      return buildPathFromPattern(targetPattern, params);
    }
  }

  const localisedCandidates = sortPatternsBySpecificity(
    Object.values(localisedUrls).flatMap(localisedUrlEntry => {
      const targetPattern = localisedUrlEntry[targetLanguage];
      if (!targetPattern) {
        return [];
      }

      return languages
        .map(language => localisedUrlEntry[language])
        .filter((sourcePattern): sourcePattern is string =>
          Boolean(sourcePattern),
        )
        .map(sourcePattern => ({
          pattern: sourcePattern,
          sourcePattern,
          targetPattern,
        }));
    }),
  );

  for (const { sourcePattern, targetPattern } of localisedCandidates) {
    const params = matchPathPattern(normalizedPathname, sourcePattern);
    if (params) {
      return buildPathFromPattern(targetPattern, params);
    }
  }

  return normalizedPathname;
};

/**
 * Reverse-map a language-specific pathname (without language prefix) back to
 * the canonical, language-agnostic path: localized slug patterns are matched
 * against every language variant and rebuilt from the canonical map key.
 */
export const resolveCanonicalLocalisedPath = (
  pathname: string,
  languages: string[],
  localisedUrls: LocalisedUrlsMap,
): string => {
  const normalizedPathname = normalisePathname(pathname);

  const canonicalCandidates = sortPatternsBySpecificity(
    Object.entries(localisedUrls).map(
      ([canonicalPattern, localisedUrlEntry]) => ({
        pattern: canonicalPattern,
        canonicalPattern,
        localisedUrlEntry,
      }),
    ),
  );

  for (const { canonicalPattern, localisedUrlEntry } of canonicalCandidates) {
    const canonicalParams = matchPathPattern(
      normalizedPathname,
      canonicalPattern,
    );
    if (canonicalParams) {
      return buildPathFromPattern(canonicalPattern, canonicalParams);
    }

    for (const language of languages) {
      const sourcePattern = localisedUrlEntry[language];
      if (!sourcePattern) {
        continue;
      }

      const params = matchPathPattern(normalizedPathname, sourcePattern);
      if (params) {
        return buildPathFromPattern(canonicalPattern, params);
      }
    }
  }

  return normalizedPathname;
};

const stripLanguagePrefix = (pathname: string, languages: string[]): string => {
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length > 0 && languages.includes(segments[0])) {
    return `/${segments.slice(1).join('/')}`;
  }

  return pathname || '/';
};

export const localiseTargetPathname = (
  pathname: string,
  language: string,
  languages: string[],
  localisedUrls?: LocalisedUrlsOption,
): string => {
  const pathWithoutLanguage = stripLanguagePrefix(pathname, languages);
  const localisedUrlsConfig = resolveLocalisedUrlsConfig(localisedUrls);
  const resolvedPath = localisedUrlsConfig.enabled
    ? resolveLocalisedPath(
        pathWithoutLanguage,
        language,
        languages,
        localisedUrlsConfig.map,
      )
    : pathWithoutLanguage;
  const resolvedSegments = resolvedPath.split('/').filter(Boolean);

  return `/${[language, ...resolvedSegments].join('/')}`;
};

export const canonicalTargetPathname = (
  pathname: string,
  languages: string[],
  localisedUrls?: LocalisedUrlsOption,
): string => {
  const pathWithoutLanguage = stripLanguagePrefix(pathname, languages);
  const localisedUrlsConfig = resolveLocalisedUrlsConfig(localisedUrls);

  return localisedUrlsConfig.enabled
    ? resolveCanonicalLocalisedPath(
        pathWithoutLanguage,
        languages,
        localisedUrlsConfig.map,
      )
    : pathWithoutLanguage;
};
