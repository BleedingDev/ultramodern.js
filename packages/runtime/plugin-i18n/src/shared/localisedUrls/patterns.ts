import { normalisePathname, normalisePathPattern } from './normalise';

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

export const sortPatternsBySpecificity = <T extends { pattern: string }>(
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

const encodeSplatParam = (value: string): string =>
  value.split('/').map(encodeURIComponent).join('/');

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
        return encodeSplatParam(params['*'] || '');
      }
      return segment;
    })
    .filter(Boolean)
    .join('/');

  return `/${path}`;
};
