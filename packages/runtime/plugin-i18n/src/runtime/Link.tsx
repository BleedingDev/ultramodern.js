import type React from 'react';
import { useMemo } from 'react';
import type {
  LinkParamsProp,
  LinkTargetPathname,
  ValidateLinkTo,
} from './canonicalRoutes';
import { useModernI18n } from './context';
import {
  interpolateRouteParams,
  type LinkParams,
  mergeClassNames,
  normalizeSearch,
  splitActiveProps,
  warnOnce,
} from './linkHelpers';
import { canonicalPath, type LocalizedPathsConfig } from './localizedPaths';
import { useI18nRouterAdapter } from './routerAdapter';
import { buildLocalizedUrl, splitUrlTarget } from './utils';

export type { LinkParams };
export { interpolateRouteParams };

const EXTERNAL_TARGET_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

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
  /**
   * Prefetching behavior, forwarded to the underlying router link:
   * react-router gets it verbatim (Modern.js `PrefetchLink` supports it),
   * TanStack receives it as its native `preload` prop (`'none'` -> `false`).
   * Stripped from plain `<a>` fallbacks (external / no-router targets).
   */
  prefetch?: 'intent' | 'render' | 'viewport' | 'none';
  /**
   * Native preload value of the underlying router link. When set, it wins
   * over `prefetch` on the TanStack branch.
   */
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
    prefetch,
    preload,
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
    const { replace: _replace, ...anchorProps } = rest;

    return (
      <a href={to} {...anchorProps}>
        {children}
      </a>
    );
  }

  const { Link: RouterLink, hasRouter, framework } = adapter;

  if (!hasRouter || !RouterLink) {
    const { replace: _replace, ...anchorProps } = rest;
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
    // TanStack's prop is `preload`; map our react-router-flavored `prefetch`
    // onto it (`'none'` -> `false`). An explicit native `preload` wins.
    const tanstackPreload =
      preload !== undefined
        ? preload
        : prefetch === undefined
          ? undefined
          : prefetch === 'none'
            ? false
            : prefetch;

    // Pass hash/search natively: string-concatenated targets silently break
    // TanStack navigation.
    return (
      <RouterLink
        to={target.localizedPathname}
        {...(target.searchObject ? { search: target.searchObject } : {})}
        {...(target.hash ? { hash: target.hash } : {})}
        {...(hashScrollIntoView === undefined ? {} : { hashScrollIntoView })}
        {...(tanstackPreload === undefined ? {} : { preload: tanstackPreload })}
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
      {...(prefetch === undefined ? {} : { prefetch })}
      {...(preload === undefined ? {} : { preload })}
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
