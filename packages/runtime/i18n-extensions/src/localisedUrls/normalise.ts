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

export const normaliseRoutePath = (path: string): string => {
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

export const stripLeadingLocaleParam = (path?: string): string | undefined => {
  const segments = splitPathSegments(path);
  const leadingLocaleParam = getLocaleParamSegment(segments[0] || '');

  if (!leadingLocaleParam) {
    return path;
  }

  const remainingPath = segments.slice(1).join('/');
  return remainingPath ? `/${remainingPath}` : undefined;
};

export const getLeadingLocaleParam = (path?: string): string | null => {
  const segments = splitPathSegments(path);
  return getLocaleParamSegment(segments[0] || '');
};
