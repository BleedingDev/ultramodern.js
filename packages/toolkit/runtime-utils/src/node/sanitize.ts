const DEFAULT_UNSAFE_SSR_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
  'x-forwarded-client-cert',
  'cf-access-jwt-assertion',
] as const;

type SanitizeSSRPayloadOptions = {
  unsafeHeaders?: string[];
  treatRootAsHeaders?: boolean;
};

type SanitizeSSRPayloadResult<T> = {
  payload: T;
  removed: string[];
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
};

const isHeaderContainerKey = (key: string) => {
  const normalized = key.toLowerCase();
  return normalized === 'headers' || normalized.endsWith('headers');
};

const normalizeHeaderName = (header: string) => header.trim().toLowerCase();

const createUnsafeHeaderSet = (unsafeHeaders: string[] = []) => {
  const headers = new Set<string>(DEFAULT_UNSAFE_SSR_HEADERS);
  for (const header of unsafeHeaders) {
    const normalized = normalizeHeaderName(header);
    if (normalized) {
      headers.add(normalized);
    }
  }
  return headers;
};

export const sanitizeSSRPayload = <T>(
  payload: T,
  options: SanitizeSSRPayloadOptions = {},
): SanitizeSSRPayloadResult<T> => {
  const removed: string[] = [];
  const visited = new WeakMap<object, unknown>();
  const unsafeHeaderSet = createUnsafeHeaderSet(options.unsafeHeaders);

  const walk = (
    value: unknown,
    path: string,
    insideHeaderContainer: boolean,
  ): unknown => {
    if (Array.isArray(value)) {
      const cached = visited.get(value);
      if (cached) {
        return cached;
      }

      const next: unknown[] = [];
      visited.set(value, next);
      value.forEach((item, index) => {
        next.push(walk(item, `${path}[${index}]`, insideHeaderContainer));
      });
      return next;
    }

    if (!isPlainObject(value)) {
      return value;
    }

    const cached = visited.get(value);
    if (cached) {
      return cached;
    }

    const next: Record<string, unknown> = {};
    visited.set(value, next);

    for (const [key, currentValue] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (
        insideHeaderContainer &&
        unsafeHeaderSet.has(normalizeHeaderName(key))
      ) {
        removed.push(nextPath);
        continue;
      }

      next[key] = walk(currentValue, nextPath, isHeaderContainerKey(key));
    }
    return next;
  };

  return {
    payload: walk(payload, '', options.treatRootAsHeaders ?? false) as T,
    removed,
  };
};
