import {
  canonicalPath,
  localizePath,
} from '@modern-js/i18n-runtime-extensions/paths';
import { createElement, useContext } from 'octane';
import { Link, type LinkComponentProps, useLocation } from '../router';
import { I18nContext } from './context';

export interface LocalizedLinkProps {
  /** A canonical, language-agnostic target, e.g. `/products/red-shoe`. */
  to: string;
  /** Localize for a specific language instead of the current one. */
  language?: string;
  children?: unknown;
  class?: string;
  activeProps?: LinkComponentProps<'a'>['activeProps'];
  inactiveProps?: LinkComponentProps<'a'>['inactiveProps'];
  activeOptions?: LinkComponentProps<'a'>['activeOptions'];
  replace?: boolean;
  preload?: LinkComponentProps<'a'>['preload'];
}

/**
 * A thin wrapper over the native Octane router `Link`
 * (`@octanejs/tanstack-router`'s precompiled `Link.tsrx`) that localizes a
 * canonical `to` for the current (or an explicit) language
 * before handing it to the real link — the same contract as
 * `@modern-js/plugin-i18n`'s React `Link`. Does not depend on the router
 * having an i18n `rewrite` configured: it resolves the href itself via the
 * shared pathname helpers, so it works whether or not phase-2 router wiring
 * has happened yet.
 *
 * No JSX: built with `createElement`, matching this package's existing
 * style (see `src/routes.ts`).
 */
export function LocalizedLink(props: LocalizedLinkProps) {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error(
      '[renderer-octane] LocalizedLink was used outside of an I18nProvider.',
    );
  }

  const href = localizePath(props.to, props.language ?? context.language, {
    languages: [...context.languages],
    localisedUrls: context.localisedUrls,
  });

  return createElement(
    Link,
    {
      // `href` wins over `to` in router-core's `buildLocation` (checks
      // `dest.href` first); `to="."` only satisfies the type-level
      // requirement that a `to` be present and is otherwise inert.
      to: '.',
      href,
      class: props.class,
      activeProps: props.activeProps,
      inactiveProps: props.inactiveProps,
      activeOptions: props.activeOptions,
      replace: props.replace,
      preload: props.preload,
    },
    props.children,
  );
}

/**
 * Language-invariant active check: `to="/products"` is active whether the
 * current location is `/en/products` or `/produkty` under a mapped locale.
 */
export function useIsLocalizedActive(canonicalTarget: string): boolean {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error(
      '[renderer-octane] useIsLocalizedActive was used outside of an I18nProvider.',
    );
  }
  const location = useLocation();
  return (
    canonicalPath(location.pathname, {
      languages: [...context.languages],
      localisedUrls: context.localisedUrls,
    }) === canonicalTarget
  );
}
