const warnedTargets = new Set<string>();

export const warnOnce = (key: string, message: string) => {
  if (process.env.NODE_ENV !== 'development' || warnedTargets.has(key)) {
    return;
  }
  warnedTargets.add(key);
  console.warn(message);
};

export type LinkParams = Record<string, string | number | undefined>;
type NormalizedSearchValue = string | string[];

/**
 * Interpolate `$param`, `:param`, optional (`{-$param}` / `:param?`) and splat
 * (`$` / `*`) segments with concrete values before localization, so
 * pattern-mapped slugs localize correctly.
 */
export const interpolateRouteParams = (
  pathname: string,
  params?: LinkParams,
): string => {
  if (!/[$:*{]/.test(pathname)) {
    return pathname;
  }

  const resolveParam = (name: string): string | undefined => {
    const value = params?.[name];
    return value === undefined ? undefined : String(value);
  };

  const segments = pathname
    .split('/')
    .map(segment => {
      if (!segment) {
        return segment;
      }

      if (segment.startsWith('{-$') && segment.endsWith('}')) {
        const value = resolveParam(segment.slice(3, -1));
        return value === undefined ? null : encodeURIComponent(value);
      }

      if (segment === '$' || segment === '*') {
        const value = resolveParam('_splat') ?? resolveParam('*');
        return value === undefined
          ? null
          : value.split('/').map(encodeURIComponent).join('/');
      }

      if (segment.startsWith('$')) {
        const value = resolveParam(segment.slice(1));
        if (value === undefined) {
          warnOnce(
            `missing-param:${pathname}:${segment}`,
            `[plugin-i18n] <Link to="${pathname}"> is missing required param "${segment.slice(1)}".`,
          );
          return segment;
        }
        return encodeURIComponent(value);
      }

      if (segment.startsWith(':')) {
        const optional = segment.endsWith('?');
        const name = segment.slice(1, optional ? -1 : undefined);
        const value = resolveParam(name);
        if (value === undefined) {
          if (optional) {
            return null;
          }
          warnOnce(
            `missing-param:${pathname}:${segment}`,
            `[plugin-i18n] <Link to="${pathname}"> is missing required param "${name}".`,
          );
          return segment;
        }
        return encodeURIComponent(value);
      }

      return segment;
    })
    .filter(segment => segment !== null);

  return segments.join('/') || '/';
};

export const normalizeSearch = (
  search: string | Record<string, unknown> | undefined,
  searchFromTo: string,
): {
  searchString: string;
  searchObject: Record<string, NormalizedSearchValue> | undefined;
} => {
  if (search && typeof search === 'object') {
    const searchObject: Record<string, NormalizedSearchValue> = {};
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(search)) {
      if (value === undefined || value === null) {
        continue;
      }

      if (Array.isArray(value)) {
        const values = value
          .filter(item => item !== undefined && item !== null)
          .map(String);
        if (values.length === 0) {
          continue;
        }
        searchObject[key] = values;
        for (const item of values) {
          params.append(key, item);
        }
        continue;
      }

      const stringValue = String(value);
      searchObject[key] = stringValue;
      params.append(key, stringValue);
    }

    const serialized = params.toString();
    return {
      searchString: serialized ? `?${serialized}` : '',
      searchObject:
        Object.keys(searchObject).length > 0 ? searchObject : undefined,
    };
  }

  const raw = typeof search === 'string' ? search : searchFromTo;
  if (!raw) {
    return { searchString: '', searchObject: undefined };
  }

  const searchString = raw.startsWith('?') ? raw : `?${raw}`;
  const searchObject: Record<string, NormalizedSearchValue> = {};
  new URLSearchParams(searchString).forEach((value, key) => {
    const existing = searchObject[key];
    if (existing === undefined) {
      searchObject[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      searchObject[key] = [existing, value];
    }
  });

  return { searchString, searchObject };
};

type ActivePropsResult<TActiveProps extends Record<string, unknown>> = Record<
  string,
  unknown
> &
  Partial<TActiveProps>;

export const splitActiveProps = <TActiveProps extends Record<string, unknown>>(
  active: boolean,
  activeProps?: TActiveProps,
): ActivePropsResult<TActiveProps> => {
  if (!active || !activeProps) {
    return {};
  }
  return activeProps;
};

export const mergeClassNames = (
  ...values: Array<unknown>
): string | undefined => {
  const classNames = values.filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return classNames.length > 0 ? classNames.join(' ') : undefined;
};
