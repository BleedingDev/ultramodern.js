import type React from 'react';
import { useMemo } from 'react';
import type {
  LinkParamsProp,
  LinkTargetPathname,
  ValidateLinkTo,
} from './canonicalRoutes';
import { useModernI18n } from './context';
import { canonicalPath, type LocalizedPathsConfig } from './localizedPaths';
import { useI18nRouterAdapter } from './routerAdapter';
import { buildLocalizedUrl, splitUrlTarget } from './utils';

const EXTERNAL_TARGET_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

const warnedTargets = new Set<string>();

const warnOnce = (key: string, message: string) => {
  if (process.env.NODE_ENV !== 'development' || warnedTargets.has(key)) {
    return;
  }
  warnedTargets.add(key);
  console.warn(message);
};

export type LinkParams = Record<string, string | number | undefined>;

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

export interface LinkActiveOptions {
  /**
   * `true`: active only when the location matches the target exactly.
   * `false`: also active when the location is nested under the target.
   * Defaults to prefix matching, except for `/` which defaults to exact.
   */
  exact?: boolean;
}

type AnchorRest = Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'href' | 'children'
>;

export interface LinkBaseProps extends AnchorRest {
  children?: React.ReactNode;
  /** Hash fragment without the leading `#`. Overrides a `#hash` inside `to`. */
  hash?: string;
  /** Search params. Object form is passed natively to TanStack Link. */
  search?: string | Record<string, unknown>;
  hashScrollIntoView?: boolean | ScrollIntoViewOptions;
  replace?: boolean;
  prefetch?: 'intent' | 'render' | 'viewport' | 'none';
  preload?: unknown;
  activeOptions?: LinkActiveOptions;
  /** Extra anchor props applied when the link is active. */
  activeProps?: AnchorRest & Record<string, unknown>;
  [key: string]: unknown;
}

export type LinkProps<TTo extends string = string> = LinkBaseProps & {
  to: TTo;
} & ValidateLinkTo<TTo> &
  LinkParamsProp<LinkTargetPathname<TTo>>;

const normalizeSearch = (
  search: string | Record<string, unknown> | undefined,
  searchFromTo: string,
): {
  searchString: string;
  searchObject: Record<string, string> | undefined;
} => {
  if (search && typeof search === 'object') {
    const entries = Object.entries(search).filter(
      ([, value]) => value !== undefined && value !== null,
    );
    const searchObject = Object.fromEntries(
      entries.map(([key, value]) => [key, String(value)]),
    );
    const params = new URLSearchParams(searchObject);
    const serialized = params.toString();
    return {
      searchString: serialized ? `?${serialized}` : '',
      searchObject,
    };
  }

  const raw = typeof search === 'string' && search ? search : searchFromTo;
  if (!raw) {
    return { searchString: '', searchObject: undefined };
  }

  const searchString = raw.startsWith('?') ? raw : `?${raw}`;
  const searchObject: Record<string, string> = {};
  new URLSearchParams(searchString).forEach((value, key) => {
    searchObject[key] = value;
  });

  return { searchString, searchObject };
};

const splitActiveProps = (
  active: boolean,
  activeProps?: LinkBaseProps['activeProps'],
) => {
  if (!active || !activeProps) {
    return {};
  }
  return activeProps;
};

const mergeClassNames = (...values: Array<unknown>): string | undefined => {
  const classNames = values.filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return classNames.length > 0 ? classNames.join(' ') : undefined;
};

/**
 * The standard UltraModern link: a vanilla link in every respect except that
 * it localizes canonical, language-agnostic paths automatically.
 *
 * - `to` accepts canonical routes (`/talks/$slug`), optionally with `#hash`
 *   and `?query` suffixes; both survive localization.
 * - External URLs and bare `#hash` targets render a plain `<a>`.
 * - Active state is language-invariant: a canonical `to` is active when the
 *   current location matches any localized variant of that route.
 *
 * @example
 * ```tsx
 * <Link to="/talks/$slug" params={{ slug: talk.slug }} hash="abstract" />
 * <Link to="/platform" />            // -> /cs/platforma under cs
 * <Link to="/#work-with-me" />       // cross-page hash, SPA navigation
 * <Link to="https://ai.bleeding.dev" /> // external -> plain <a>
 * ```
 */
export const Link = <TTo extends string = string>(
  props: LinkProps<TTo>,
): React.ReactElement => {
  const {
    to,
    params,
    children,
    hash: hashProp,
    search: searchProp,
    hashScrollIntoView,
    activeOptions,
    activeProps,
    ...rest
  } = props as LinkBaseProps & { to: string; params?: LinkParams };

  const adapter = useI18nRouterAdapter();
  const { language, supportedLanguages, localisedUrls } = useModernI18n();

  const config: LocalizedPathsConfig = {
    languages: supportedLanguages,
    localisedUrls,
  };

  const isExternal = EXTERNAL_TARGET_RE.test(to);
  const isBareHash = to.startsWith('#');

  const target = useMemo(() => {
    if (isExternal || isBareHash) {
      return null;
    }

    const {
      pathname,
      search: searchFromTo,
      hash: hashFromTo,
    } = splitUrlTarget(to);
    const interpolated = interpolateRouteParams(pathname || '/', params);

    const firstSegment = interpolated.split('/').filter(Boolean)[0];
    if (firstSegment && supportedLanguages.includes(firstSegment)) {
      warnOnce(
        `lang-prefix:${to}`,
        `[plugin-i18n] <Link to="${to}"> starts with a language prefix. ` +
          'Write language-agnostic canonical paths; the Link localizes them automatically.',
      );
    }

    const localizedPathname = buildLocalizedUrl(
      interpolated,
      language,
      supportedLanguages,
      localisedUrls,
    );
    const hash = hashProp ?? (hashFromTo ? hashFromTo.slice(1) : '');
    const { searchString, searchObject } = normalizeSearch(
      searchProp,
      searchFromTo,
    );

    return {
      canonicalPathname: interpolated,
      localizedPathname,
      hash,
      searchString,
      searchObject,
      href: `${localizedPathname}${searchString}${hash ? `#${hash}` : ''}`,
    };
  }, [
    to,
    params,
    hashProp,
    searchProp,
    isExternal,
    isBareHash,
    language,
    supportedLanguages,
    localisedUrls,
  ]);

  const isActive = useMemo(() => {
    if (!target || !adapter.location) {
      return false;
    }

    const current = canonicalPath(adapter.location.pathname, config);
    const targetCanonical = canonicalPath(target.canonicalPathname, config);
    const exact = activeOptions?.exact ?? targetCanonical === '/';

    if (current === targetCanonical) {
      return true;
    }
    if (exact) {
      return false;
    }
    return current.startsWith(
      targetCanonical === '/' ? '/' : `${targetCanonical}/`,
    );
  }, [
    target,
    adapter.location,
    activeOptions?.exact,
    supportedLanguages,
    localisedUrls,
  ]);

  const resolvedActiveProps = splitActiveProps(isActive, activeProps);
  const activeAttributes = isActive
    ? {
        'data-status': 'active',
        'aria-current': (rest['aria-current'] ??
          resolvedActiveProps['aria-current'] ??
          'page') as React.AriaAttributes['aria-current'],
      }
    : {};

  // External targets and same-page anchors are vanilla links.
  if (!target) {
    const {
      prefetch: _prefetch,
      preload: _preload,
      replace: _replace,
      ...anchorProps
    } = rest;

    return (
      <a href={to} {...anchorProps}>
        {children}
      </a>
    );
  }

  const { Link: RouterLink, hasRouter, framework } = adapter;

  if (!hasRouter || !RouterLink) {
    const {
      prefetch: _prefetch,
      preload: _preload,
      replace: _replace,
      ...anchorProps
    } = rest;
    const {
      className: activeClassName,
      style: activeStyle,
      ...activeRest
    } = resolvedActiveProps;

    return (
      <a
        href={target.href}
        {...anchorProps}
        {...activeRest}
        {...activeAttributes}
        className={mergeClassNames(rest.className, activeClassName)}
        style={{
          ...(rest.style as React.CSSProperties | undefined),
          ...(activeStyle as React.CSSProperties | undefined),
        }}
      >
        {children}
      </a>
    );
  }

  const {
    className: activeClassName,
    style: activeStyle,
    ...activeRest
  } = resolvedActiveProps;
  const mergedClassName = mergeClassNames(rest.className, activeClassName);
  const mergedStyle = {
    ...(rest.style as React.CSSProperties | undefined),
    ...(activeStyle as React.CSSProperties | undefined),
  };

  if (framework === 'tanstack') {
    // Pass hash/search natively: string-concatenated targets silently break
    // TanStack navigation.
    return (
      <RouterLink
        to={target.localizedPathname}
        {...(target.searchObject ? { search: target.searchObject } : {})}
        {...(target.hash ? { hash: target.hash } : {})}
        {...(hashScrollIntoView === undefined ? {} : { hashScrollIntoView })}
        {...rest}
        {...activeRest}
        {...activeAttributes}
        className={mergedClassName}
        style={mergedStyle}
      >
        {children}
      </RouterLink>
    );
  }

  return (
    <RouterLink
      to={target.href}
      {...rest}
      {...activeRest}
      {...activeAttributes}
      className={mergedClassName}
      style={mergedStyle}
    >
      {children}
    </RouterLink>
  );
};

export default Link;
