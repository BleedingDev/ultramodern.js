import {
  canonicalPath,
  configuredLanguage,
  localizePath,
} from '@modern-js/i18n-runtime-extensions/paths';
import { createElement, hookSlots, type OctaneNode, useContext } from 'octane';
import {
  Link,
  type LinkComponentProps,
  useLocation,
  useRouter,
} from '../router';
import { I18nContext } from './context';

// Plain TypeScript is not rewritten by the Octane compiler: router hooks take
// their stable slot explicitly.
const locationSlot = Symbol(hookSlots(1));

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
 * canonical `to` for the current (or an explicit) language before handing it
 * to the real link — the same contract as `@modern-js/plugin-i18n`'s React
 * `Link`. It resolves the href itself via the shared pathname helpers, so it
 * works with or without the router's i18n `rewrite`. Every link, including
 * one to another language, is the native `Link`: navigation, preloading and
 * active state stay with the router.
 *
 * Under the i18n `rewrite` the router matches canonical paths and localizes
 * outgoing locations to the current language, so a link to another language
 * routes to the canonical `to` and publishes the target language's URL as a
 * route mask (the rewrite keeps a mask's explicit language). The entry's
 * router language synchronization (`syncWithRouter`) switches the i18next
 * instance from the navigated URL, as it does for history navigation.
 *
 * No JSX: built with `createElement`, matching this package's existing
 * style (see `src/routes.ts`).
 */
export function LocalizedLink(props: LocalizedLinkProps): OctaneNode {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error(
      '[renderer-octane] LocalizedLink was used outside of an I18nProvider.',
    );
  }
  const router = useRouter();

  // An explicit language must be configured: it becomes the locale prefix.
  const language =
    props.language === undefined
      ? context.language
      : configuredLanguage(props.language, context.languages);
  const href = localizePath(props.to, language, {
    languages: [...context.languages],
    localisedUrls: context.localisedUrls,
  });
  const crossLanguage = language !== context.language;
  const rewrite = Boolean(router.options.rewrite);

  return createElement(
    Link,
    {
      // Octane's `Link` builds its location from `to` alone. Under the i18n
      // router rewrite the router matches canonical paths and localizes the
      // public href itself; without it, the localized path is the route path.
      to: rewrite ? props.to : href,
      ...(rewrite && crossLanguage ? { mask: { to: href } } : {}),
      ...(crossLanguage ? { hreflang: language } : {}),
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
  const location = useLocation(undefined, locationSlot);
  return (
    canonicalPath(location.pathname, {
      languages: [...context.languages],
      localisedUrls: context.localisedUrls,
    }) === canonicalTarget
  );
}
