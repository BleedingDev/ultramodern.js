import {
  getLeadingLocaleParam,
  normalisePathPattern,
  normaliseRoutePath,
  stripLeadingLocaleParam,
} from './normalise';
import {
  doPathPatternsOverlap,
  getOrderedPathParamSignature,
  getPathParamSignature,
  getPathPatternValidationIssue,
  getPhysicalPathPattern,
  haveEqualPatternSpecificity,
} from './patterns';
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

const legalRouteIdPart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_$-]+/g, '_').replace(/^_+|_+$/g, '') || 'index';

const formatParamSignature = (signature: string[]): string =>
  signature.length > 0 ? signature.join(', ') : '(none)';

const validateLocalisedUrlPatterns = (
  languages: string[],
  localisedUrls: LocalisedUrlsMap,
) => {
  const physicalPatterns = new Map<
    string,
    { canonicalPath: string; source: string }
  >();
  const claimedPatterns: Array<{
    canonicalPath: string;
    pattern: string;
    source: string;
  }> = [];

  const claimPhysicalPattern = (
    sourcePattern: string,
    canonicalPath: string,
    source: string,
  ) => {
    const physicalPattern = getPhysicalPathPattern(sourcePattern);
    const existing = physicalPatterns.get(physicalPattern);
    if (existing && existing.canonicalPath !== canonicalPath) {
      throw new Error(
        `localisedUrls["${existing.canonicalPath}"] ${existing.source} and localisedUrls["${canonicalPath}"] ${source} generate the same physical route pattern "${physicalPattern}". Localised route patterns must identify exactly one canonical route.`,
      );
    }

    const overlapping = claimedPatterns.find(
      claimed =>
        claimed.canonicalPath !== canonicalPath &&
        haveEqualPatternSpecificity(claimed.pattern, sourcePattern) &&
        doPathPatternsOverlap(claimed.pattern, sourcePattern),
    );
    if (overlapping) {
      throw new Error(
        `localisedUrls["${overlapping.canonicalPath}"] ${overlapping.source} pattern "${overlapping.pattern}" and localisedUrls["${canonicalPath}"] ${source} pattern "${sourcePattern}" are equal-specificity overlapping route patterns. Localised route patterns must identify exactly one canonical route.`,
      );
    }

    physicalPatterns.set(physicalPattern, { canonicalPath, source });
    claimedPatterns.push({ canonicalPath, pattern: sourcePattern, source });
  };

  for (const [canonicalPath, entry] of Object.entries(localisedUrls).sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
  )) {
    const canonicalIssue = getPathPatternValidationIssue(canonicalPath);
    if (canonicalIssue) {
      throw new Error(
        `localisedUrls["${canonicalPath}"] canonical pattern has ${canonicalIssue}.`,
      );
    }
    const expectedSignature = getPathParamSignature(canonicalPath);
    const expectedOrderedSignature =
      getOrderedPathParamSignature(canonicalPath);
    claimPhysicalPattern(canonicalPath, canonicalPath, 'canonical pattern');

    for (const language of languages) {
      const localisedPattern = entry[language];
      if (!localisedPattern) {
        continue;
      }

      const localisedIssue = getPathPatternValidationIssue(localisedPattern);
      if (localisedIssue) {
        throw new Error(
          `localisedUrls["${canonicalPath}"].${language} has ${localisedIssue}.`,
        );
      }

      const actualSignature = getPathParamSignature(localisedPattern);
      if (
        actualSignature.length !== expectedSignature.length ||
        actualSignature.some(
          (parameter, index) => parameter !== expectedSignature[index],
        )
      ) {
        throw new Error(
          `localisedUrls["${canonicalPath}"].${language} must use the same parameter signature as "${canonicalPath}": expected ${formatParamSignature(
            expectedSignature,
          )}; received ${formatParamSignature(actualSignature)}.`,
        );
      }

      const actualOrderedSignature =
        getOrderedPathParamSignature(localisedPattern);
      if (
        expectedOrderedSignature.some(
          parameter => parameter === '*' || parameter.endsWith('?'),
        ) &&
        actualOrderedSignature.some(
          (parameter, index) => parameter !== expectedOrderedSignature[index],
        )
      ) {
        throw new Error(
          `localisedUrls["${canonicalPath}"].${language} must keep optional and splat parameters in canonical order: expected ${formatParamSignature(
            expectedOrderedSignature,
          )}; received ${formatParamSignature(actualOrderedSignature)}.`,
        );
      }

      claimPhysicalPattern(localisedPattern, canonicalPath, `.${language}`);
    }
  }
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
  routes: LocalisedRoute[],
  languages: string[],
  localisedUrls: LocalisedUrlsMap,
) => {
  validateLocalisedUrlPatterns(languages, localisedUrls);

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

const getLocalisedRouteIdSuffixes = (
  paths: string[],
): Array<string | undefined> => {
  const usedSuffixes = new Set<string>();

  return paths.map((path, index) => {
    if (index === 0) {
      return undefined;
    }

    const baseSuffix = legalRouteIdPart(path);
    let suffix = baseSuffix;
    let disambiguator = 2;
    while (usedSuffixes.has(suffix)) {
      suffix = `${baseSuffix}_${disambiguator++}`;
    }
    usedSuffixes.add(suffix);
    return suffix;
  });
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

  const uniquePaths = Array.from(new Set(paths.filter(Boolean) as string[]));
  return uniquePaths;
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

  const localisedPaths = getLocalisedRoutePaths(
    canonicalPath,
    parentLocalisedPaths,
    languages,
    localisedUrlEntry,
  );
  const leadingLocaleParam = getLeadingLocaleParam(route.path);
  const routeIdPaths = leadingLocaleParam
    ? localisedPaths.map(path =>
        normaliseRoutePath(`${leadingLocaleParam}/${path}`),
      )
    : localisedPaths;
  const routeIdSuffixes = getLocalisedRouteIdSuffixes(routeIdPaths);

  return localisedPaths.map((localisedPath, index) =>
    cloneRouteWithLocalisedPath(
      baseRoute,
      localisedPath,
      routeIdSuffixes[index],
      canonicalPath,
    ),
  );
};

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

const collectRouteIdCounts = (
  routes: LocalisedRoute[],
  counts = new Map<string, number>(),
): Map<string, number> => {
  for (const route of routes) {
    if (route.id) {
      counts.set(route.id, (counts.get(route.id) ?? 0) + 1);
    }
    if ('children' in route && route.children) {
      collectRouteIdCounts(route.children, counts);
    }
  }
  return counts;
};

const validateNoNewRouteIdCollisions = (
  sourceRoutes: LocalisedRoute[],
  localisedRoutes: LocalisedRoute[],
) => {
  const sourceCounts = collectRouteIdCounts(sourceRoutes);
  const localisedCounts = collectRouteIdCounts(localisedRoutes);

  for (const [routeId, count] of localisedCounts) {
    if (count > 1 && count > (sourceCounts.get(routeId) ?? 0)) {
      throw new Error(
        `Localised route expansion generated duplicate route ID "${routeId}". Change the source route ID or localised path so every generated route remains identifiable.`,
      );
    }
  }
};

const cloneRouteWithLocalisedPath = (
  route: LocalisedRoute,
  path: string,
  routeIdSuffix: string | undefined,
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

  return routeIdSuffix
    ? suffixRouteIds(routeWithPath, routeIdSuffix)
    : routeWithPath;
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

  const localisedRoutes = routes.flatMap(route =>
    transformLocalisedRoute(
      route,
      '',
      rootLocalisedPaths,
      languages,
      localisedUrls,
    ),
  );
  validateNoNewRouteIdCollisions(routes, localisedRoutes);
  return localisedRoutes;
};
