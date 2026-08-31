function getRouteI18nEntry(route) {
  if (!route || typeof route.entryName !== 'string') {
    return undefined;
  }

  return MODERN_WORKER_MANIFEST.i18n?.entries?.[route.entryName];
}

function getRouteBasePath(route) {
  const routePath =
    typeof route?.urlPath === 'string'
      ? normalizeRoutePath(route.urlPath)
      : '/';

  return routePath || '/';
}

function getRouteRemainingPathname(route, pathname) {
  const basePath = getRouteBasePath(route);

  if (basePath === '/') {
    return pathname || '/';
  }

  if (!matchesPrefix(pathname, basePath)) {
    return pathname || '/';
  }

  const remaining = pathname.slice(basePath.length);
  return remaining
    ? remaining.startsWith('/')
      ? remaining
      : `/${remaining}`
    : '/';
}

function normalizeLanguage(value, languages) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  const exact = languages.find(
    language => language.toLowerCase() === normalized,
  );

  if (exact) {
    return exact;
  }

  const baseLanguage = normalized.split(/[-_]/u)[0];

  return (
    languages.find(language => language.toLowerCase() === baseLanguage) || null
  );
}

function getLanguageFromPath(route, pathname, languages) {
  const remainingPathname = getRouteRemainingPathname(route, pathname);
  const firstSegment = remainingPathname.split('/').filter(Boolean)[0];

  return normalizeLanguage(firstSegment, languages);
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function detectLanguageFromCookie(cookieHeader, lookupCookie, languages) {
  if (!cookieHeader) {
    return null;
  }

  for (const cookiePart of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = cookiePart.trim().split('=');
    if (rawName !== lookupCookie || rawValue.length === 0) {
      continue;
    }

    return normalizeLanguage(
      safeDecodeURIComponent(rawValue.join('=')),
      languages,
    );
  }

  return null;
}

function detectLanguageFromAcceptLanguage(acceptLanguage, languages) {
  if (!acceptLanguage) {
    return null;
  }

  return (
    acceptLanguage
      .split(',')
      .map((entry, index) => {
        const [rawRange, ...rawParameters] = entry.trim().split(';');
        const qualityParameter = rawParameters.find(parameter =>
          parameter.trim().startsWith('q='),
        );
        const quality = qualityParameter
          ? Number.parseFloat(qualityParameter.split('=')[1] || '')
          : 1;

        return {
          index,
          language: normalizeLanguage(rawRange, languages),
          quality: Number.isFinite(quality) ? quality : 1,
        };
      })
      .filter(candidate => candidate.language && candidate.quality > 0)
      .sort(
        (left, right) =>
          right.quality - left.quality || left.index - right.index,
      )[0]?.language || null
  );
}

function detectRedirectLanguage(request, entry) {
  if (!entry.i18nextDetector) {
    return null;
  }

  const url = new URL(request.url);
  const detection = entry.detection || {};
  const order = Array.isArray(detection.order)
    ? detection.order
    : ['querystring', 'cookie', 'header'];

  for (const method of order) {
    const language =
      method === 'querystring'
        ? normalizeLanguage(
            url.searchParams.get(detection.lookupQuerystring || 'lng'),
            entry.languages,
          )
        : method === 'cookie'
          ? detectLanguageFromCookie(
              request.headers.get('cookie'),
              detection.lookupCookie || 'i18next',
              entry.languages,
            )
          : method === 'header'
            ? detectLanguageFromAcceptLanguage(
                request.headers.get(
                  detection.lookupHeader || 'accept-language',
                ),
                entry.languages,
              )
            : null;

    if (language) {
      return language;
    }
  }

  return null;
}

function normaliseSlashes(pathname) {
  const withoutDuplicateSlashes = pathname.replace(/\/+/g, '/');
  const withLeadingSlash = withoutDuplicateSlashes.startsWith('/')
    ? withoutDuplicateSlashes
    : `/${withoutDuplicateSlashes}`;

  return withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/+$/u, '')
    : withLeadingSlash;
}

function normalisePathPattern(pathname) {
  return normaliseSlashes(pathname).replace(/\[(.+?)\]/g, ':$1');
}

function stripLanguagePrefix(pathname, languages) {
  const segments = pathname.split('/').filter(Boolean);
  const firstSegment = segments[0];

  if (firstSegment && normalizeLanguage(firstSegment, languages)) {
    return `/${segments.slice(1).join('/')}` || '/';
  }

  return pathname || '/';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPatternParamName(segment) {
  return segment.slice(1).replace(/\?$/, '');
}

function compilePathPattern(pattern) {
  const names = [];
  const segments = normalisePathPattern(pattern).split('/').filter(Boolean);
  const source = segments
    .map(segment => {
      if (segment.startsWith(':')) {
        names.push(getPatternParamName(segment));
        return segment.endsWith('?') ? '(?:/([^/]+))?' : '/([^/]+)';
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
}

function matchPathPattern(pathname, pattern) {
  const { names, regexp } = compilePathPattern(pattern);
  const match = regexp.exec(normaliseSlashes(pathname));

  if (!match) {
    return null;
  }

  const params = {};
  for (let index = 0; index < names.length; index++) {
    try {
      params[names[index]] = decodeURIComponent(match[index + 1] || '');
    } catch {
      return null;
    }
  }

  return params;
}

function buildPathFromPattern(pattern, params) {
  const path = normalisePathPattern(pattern)
    .split('/')
    .filter(Boolean)
    .map(segment => {
      if (segment.startsWith(':')) {
        const param = params[getPatternParamName(segment)];
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
}

function patternSpecificity(pattern) {
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
    dynamicSegments,
    splatSegments,
    staticSegments,
    totalSegments: segments.length,
  };
}

function comparePatternSpecificity(left, right) {
  const leftSpecificity = patternSpecificity(left);
  const rightSpecificity = patternSpecificity(right);

  return (
    rightSpecificity.staticSegments - leftSpecificity.staticSegments ||
    rightSpecificity.totalSegments - leftSpecificity.totalSegments ||
    leftSpecificity.splatSegments - rightSpecificity.splatSegments ||
    leftSpecificity.dynamicSegments - rightSpecificity.dynamicSegments
  );
}

function sortLocalisedPatterns(patterns) {
  return patterns
    .map((pattern, index) => ({ pattern, index }))
    .sort(
      (left, right) =>
        comparePatternSpecificity(
          left.pattern.pattern,
          right.pattern.pattern,
        ) || left.index - right.index,
    )
    .map(({ pattern }) => pattern);
}

function resolveLocalisedPath(
  pathname,
  targetLanguage,
  languages,
  localisedUrls,
) {
  const normalizedPathname = normaliseSlashes(pathname);
  const canonicalCandidates = sortLocalisedPatterns(
    Object.entries(localisedUrls || {}).map(
      ([canonicalPattern, localisedUrlEntry]) => ({
        canonicalPattern,
        localisedUrlEntry,
        pattern: canonicalPattern,
      }),
    ),
  );

  for (const { canonicalPattern, localisedUrlEntry } of canonicalCandidates) {
    const targetPattern = localisedUrlEntry[targetLanguage];
    const params = targetPattern
      ? matchPathPattern(normalizedPathname, canonicalPattern)
      : null;

    if (params) {
      return buildPathFromPattern(targetPattern, params);
    }
  }

  const localisedCandidates = sortLocalisedPatterns(
    Object.values(localisedUrls || {}).flatMap(localisedUrlEntry => {
      const targetPattern = localisedUrlEntry[targetLanguage];

      if (!targetPattern) {
        return [];
      }

      return languages
        .map(language => localisedUrlEntry[language])
        .filter(Boolean)
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
}

function localiseTargetPathname(pathname, language, languages, localisedUrls) {
  const pathWithoutLanguage = stripLanguagePrefix(pathname, languages);
  const resolvedPath = localisedUrls
    ? resolveLocalisedPath(
        pathWithoutLanguage,
        language,
        languages,
        localisedUrls,
      )
    : pathWithoutLanguage;
  const resolvedSegments = resolvedPath.split('/').filter(Boolean);

  return `/${[language, ...resolvedSegments].join('/')}`;
}

function shouldIgnoreLocaleRedirect(pathname, route, entry) {
  const remainingPathname = getRouteRemainingPathname(route, pathname);
  const normalizedPathname = remainingPathname.startsWith('/')
    ? remainingPathname
    : `/${remainingPathname}`;
  const ignoredPrefixes = [
    ...(entry.ignoreRedirectRoutes || []),
    ...(entry.staticRoutePrefixes || []),
    '/static',
    '/upload',
  ];

  return ignoredPrefixes.some(prefix => {
    const normalizedPrefix = normaliseSlashes(prefix);
    return (
      normalizedPathname === normalizedPrefix ||
      normalizedPathname.startsWith(`${normalizedPrefix}/`)
    );
  });
}

function buildLocalizedUrl(route, request, language, entry) {
  const url = new URL(request.url);
  const basePath = getRouteBasePath(route);
  const remainingPathname = getRouteRemainingPathname(route, url.pathname);
  const localizedPathname = localiseTargetPathname(
    remainingPathname,
    language,
    entry.languages,
    entry.localisedUrls,
  );
  const nextPathname =
    basePath === '/'
      ? localizedPathname
      : normaliseSlashes(`${basePath}/${localizedPathname}`);

  return `${nextPathname}${url.search}`;
}

function createLocaleRedirectResponse(location, entry) {
  const headers = new Headers({
    'cache-control': 'private, no-store',
    location,
  });
  const vary = [];
  const detectionOrder = entry.i18nextDetector
    ? entry.detection?.order || []
    : [];

  if (detectionOrder.includes('header')) {
    vary.push('Accept-Language');
  }

  if (detectionOrder.includes('cookie')) {
    vary.push('Cookie');
  }

  if (vary.length > 0) {
    headers.set('vary', vary.join(', '));
  }

  return new Response(null, {
    headers,
    status: 302,
  });
}

function createLocaleRedirectResponseForRequest(route, request) {
  const entry = getRouteI18nEntry(route);

  if (
    !entry ||
    !Array.isArray(entry.languages) ||
    entry.languages.length === 0
  ) {
    return null;
  }

  const { pathname, search } = new URL(request.url);

  if (isAssetLikePathname(pathname)) {
    return null;
  }

  if (shouldIgnoreLocaleRedirect(pathname, route, entry)) {
    return null;
  }

  const language = getLanguageFromPath(route, pathname, entry.languages);

  if (!language) {
    const targetLanguage =
      detectRedirectLanguage(request, entry) || entry.fallbackLanguage;
    return createLocaleRedirectResponse(
      buildLocalizedUrl(route, request, targetLanguage, entry),
      entry,
    );
  }

  if (entry.localisedUrls) {
    const expectedUrl = buildLocalizedUrl(route, request, language, entry);

    if (expectedUrl !== `${pathname}${search}`) {
      return createLocaleRedirectResponse(expectedUrl, entry);
    }
  }

  return null;
}

function findRoute(request) {
  const { pathname } = new URL(request.url);
  const routes = MODERN_WORKER_MANIFEST.routeSpec.routes;

  return [...routes]
    .sort((left, right) => {
      const leftLength = left.urlPath?.length || 0;
      const rightLength = right.urlPath?.length || 0;

      return rightLength - leftLength;
    })
    .find(route => routeMatches(route, pathname));
}

async function fetchRouteHtml(route, request, env) {
  if (!route?.entryPath) {
    return null;
  }

  return fetchAssetByPath(route.entryPath, request, env);
}
