import { normalisePathname, normalisePathPattern } from './normalise';

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getParamName = (segment: string): string =>
  segment.slice(1).replace(/\?$/, '');

export const getOrderedPathParamSignature = (pattern: string): string[] =>
  normalisePathPattern(pattern)
    .split('/')
    .filter(Boolean)
    .flatMap(segment => {
      if (segment === '*') {
        return ['*'];
      }
      if (!segment.startsWith(':')) {
        return [];
      }

      return [`:${getParamName(segment)}${segment.endsWith('?') ? '?' : ''}`];
    });

export const getPathParamSignature = (pattern: string): string[] =>
  getOrderedPathParamSignature(pattern).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );

export const getPathPatternValidationIssue = (
  pattern: string,
): string | undefined => {
  const segments = normalisePathPattern(pattern).split('/').filter(Boolean);
  const seenParams = new Set<string>();

  for (const [index, segment] of segments.entries()) {
    if (segment === '*') {
      if (index !== segments.length - 1) {
        return 'splat parameter "*" must be the final segment';
      }
      if (seenParams.has('*')) {
        return 'duplicate splat parameter "*"';
      }
      seenParams.add('*');
      continue;
    }
    if (!segment.startsWith(':')) {
      continue;
    }

    const paramName = getParamName(segment);
    if (seenParams.has(paramName)) {
      return `duplicate path parameter ":${paramName}"`;
    }
    seenParams.add(paramName);
  }

  return undefined;
};

export const getPhysicalPathPattern = (pattern: string): string => {
  const segments = normalisePathPattern(pattern).split('/').filter(Boolean);
  const physicalSegments = segments.map(segment => {
    if (segment === '*') {
      return '*';
    }
    if (segment.startsWith(':')) {
      return segment.endsWith('?') ? ':param?' : ':param';
    }
    return segment;
  });

  return `/${physicalSegments.join('/')}`;
};

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
        return '(?:/(.*))?';
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
  let optionalSegments = 0;
  let splatSegments = 0;

  for (const segment of segments) {
    if (segment === '*') {
      splatSegments++;
    } else if (segment.startsWith(':')) {
      dynamicSegments++;
      if (segment.endsWith('?')) {
        optionalSegments++;
      }
    } else {
      staticSegments++;
    }
  }

  return {
    staticSegments,
    dynamicSegments,
    optionalSegments,
    splatSegments,
    totalSegments: segments.length,
  };
};

const comparePatternSpecificity = (left: string, right: string): number => {
  const a = getPatternSpecificity(left);
  const b = getPatternSpecificity(right);

  return (
    b.staticSegments - a.staticSegments ||
    a.splatSegments - b.splatSegments ||
    a.optionalSegments - b.optionalSegments ||
    b.totalSegments - a.totalSegments ||
    a.dynamicSegments - b.dynamicSegments
  );
};

export const haveEqualPatternSpecificity = (
  left: string,
  right: string,
): boolean => comparePatternSpecificity(left, right) === 0;

export const doPathPatternsOverlap = (left: string, right: string): boolean => {
  const leftSegments = normalisePathPattern(left).split('/').filter(Boolean);
  const rightSegments = normalisePathPattern(right).split('/').filter(Boolean);
  if (leftSegments.length !== rightSegments.length) {
    return false;
  }

  return leftSegments.every((leftSegment, index) => {
    const rightSegment = rightSegments[index];
    const leftIsDynamic = leftSegment === '*' || leftSegment.startsWith(':');
    const rightIsDynamic = rightSegment === '*' || rightSegment.startsWith(':');
    return leftIsDynamic || rightIsDynamic || leftSegment === rightSegment;
  });
};

const comparePatternNames = (left: string, right: string): number => {
  const normalizedLeft = normalisePathPattern(left);
  const normalizedRight = normalisePathPattern(right);

  return normalizedLeft < normalizedRight
    ? -1
    : normalizedLeft > normalizedRight
      ? 1
      : 0;
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
        ) ||
        comparePatternNames(left.pattern.pattern, right.pattern.pattern) ||
        left.index - right.index,
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
    Object.defineProperty(params, names[index], {
      configurable: true,
      enumerable: true,
      value: decoded,
      writable: true,
    });
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
        const paramName = getParamName(segment);
        const param = Object.hasOwn(params, paramName)
          ? params[paramName]
          : undefined;
        if (param === undefined || param === '') {
          if (segment.endsWith('?')) {
            return '';
          }
          throw new Error(
            `Missing required path parameter "${paramName}" for pattern "${normalisePathPattern(
              pattern,
            )}".`,
          );
        }
        return encodeURIComponent(param);
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
