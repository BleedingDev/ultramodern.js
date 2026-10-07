import {
  canonicalPath,
  localizePath,
} from '@modern-js/i18n-runtime-extensions/paths';
import { createElement, hookSlots, type OctaneNode, useContext } from 'octane';
import {
  Link,
  type LinkComponentProps,
  useLocation,
  useNavigate,
  useRouter,
} from '../router';
import { I18nContext } from './context';

// Plain TypeScript is not rewritten by the Octane compiler: router hooks take
// their stable slot explicitly.
const navigateSlot = Symbol(hookSlots(1));
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
 * works with or without the router's i18n `rewrite`.
 *
 * A link to another language cannot go through the router alone: the i18n
 * `rewrite` localizes every outgoing location to the *current* language. It
 * renders a plain anchor (correct href for crawlers and new tabs) whose click
 * first switches the i18next language and then navigates client-side, the
 * same order `useI18n().changeLanguage` uses. If loading that language fails,
 * native document navigation follows the anchor's URL instead.
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
  const navigate = useNavigate(undefined, navigateSlot);

  const language = props.language ?? context.language;
  const href = localizePath(props.to, language, {
    languages: [...context.languages],
    localisedUrls: context.localisedUrls,
  });

  if (language !== context.language) {
    const basepath = router.options.basepath ?? '/';
    const documentHref =
      basepath === '/' ? href : `${basepath.replace(/\/$/u, '')}${href}`;
    const instance = context.instance;
    return createElement(
      'a',
      {
        href: documentHref,
        hreflang: language,
        class: props.class,
        onClick: (event: MouseEvent) => {
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          void (async () => {
            try {
              await instance.changeLanguage?.(language);
            } catch {
              // Omit `to` so the current language rewrite cannot alter the anchor URL.
              await router.navigate({
                href: documentHref,
                reloadDocument: true,
                replace: props.replace,
              });
              return;
            }
            await navigate({ to: '.', href, replace: props.replace });
          })();
        },
      },
      props.children,
    );
  }

  return createElement(
    Link,
    {
      // Octane's `Link` builds its location from `to` alone. Under the i18n
      // router rewrite the router matches canonical paths and localizes the
      // public href itself; without it, the localized path is the route path.
      to: router.options.rewrite ? props.to : href,
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
