import {
  canonicalPath,
  configuredLanguage,
  localizePath,
} from '@modern-js/i18n-runtime-extensions/paths';
import type { JSX } from '@solidjs/web';
import * as Solid from 'solid-js';
import {
  Link,
  type LinkComponentProps,
  useLocation,
  useRouter,
} from '../router';
import { I18nContext } from './context';

export interface LocalizedLinkProps {
  /** A canonical, language-agnostic target, e.g. `/products/red-shoe`. */
  to: string;
  /** Localize for a specific language instead of the current one. */
  language?: string;
  children?: LinkComponentProps<'a'>['children'];
  class?: string;
  activeProps?: LinkComponentProps<'a'>['activeProps'];
  inactiveProps?: LinkComponentProps<'a'>['inactiveProps'];
  activeOptions?: LinkComponentProps<'a'>['activeOptions'];
  replace?: boolean;
  preload?: LinkComponentProps<'a'>['preload'];
  [key: `data-${string}`]: unknown;
}

/**
 * A thin wrapper over the native Solid router `Link` that localizes a
 * canonical `to` for the current (or an explicit) language before handing it
 * to the real link, the same contract as `@modern-js/plugin-i18n`'s React
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
 * Props are forwarded explicitly (not via object-rest or a missing
 * `splitProps`/`mergeProps` primitive — Solid 2 only exports `merge`) so
 * each one is read directly from `props` in JSX position and keeps its
 * per-key reactivity.
 */
export function LocalizedLink(props: LocalizedLinkProps): JSX.Element {
  const context = Solid.useContext(I18nContext);
  const router = useRouter();
  const rewrite = Boolean(router.options.rewrite);

  // An explicit language must be configured: it becomes the locale prefix.
  const targetLanguage = () =>
    props.language === undefined
      ? context.language()
      : configuredLanguage(props.language, context.languages);
  const href = Solid.createMemo(() =>
    localizePath(props.to, targetLanguage(), {
      languages: [...context.languages],
      localisedUrls: context.localisedUrls,
    }),
  );
  const crossLanguage = () => targetLanguage() !== context.language();
  const masked = () => rewrite && crossLanguage();
  // Declared `data-*` attributes reach the anchor through getters, so each
  // keeps its own reactivity like the explicitly forwarded props.
  const dataAttributes = Object.defineProperties(
    {},
    Object.fromEntries(
      Object.keys(props)
        .filter(key => key.startsWith('data-'))
        .map(key => [
          key,
          {
            enumerable: true,
            get: () => props[key as `data-${string}`],
          },
        ]),
    ),
  );

  return (
    <Link
      {...dataAttributes}
      // A masked link routes to the canonical `to`. Otherwise `href` wins over
      // `to` in router-core's `buildLocation` (it checks `dest.href` first);
      // `to="."` only satisfies the type-level requirement that a `to` be
      // present and is otherwise inert.
      to={masked() ? props.to : '.'}
      href={masked() ? undefined : href()}
      mask={masked() ? { to: href() } : undefined}
      hreflang={crossLanguage() ? targetLanguage() : undefined}
      class={props.class}
      activeProps={props.activeProps}
      inactiveProps={props.inactiveProps}
      activeOptions={props.activeOptions}
      replace={props.replace}
      preload={props.preload}
    >
      {props.children}
    </Link>
  );
}

/**
 * Language-invariant active check: `to="/products"` is active whether the
 * current location is `/en/products` or `/produkty` under a mapped locale.
 */
export function useIsLocalizedActive(canonicalTarget: string): () => boolean {
  const context = Solid.useContext(I18nContext);
  const location = useLocation();
  return () =>
    canonicalPath(location().pathname, {
      languages: [...context.languages],
      localisedUrls: context.localisedUrls,
    }) === canonicalTarget;
}
