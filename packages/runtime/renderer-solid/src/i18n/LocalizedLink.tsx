import {
  canonicalPath,
  localizePath,
} from '@modern-js/i18n-runtime-extensions/paths';
import type { JSX } from '@solidjs/web';
import * as Solid from 'solid-js';
import { Link, type LinkComponentProps, useLocation } from '../router';
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
 * `Link`. Does not depend on the router having an i18n `rewrite` configured:
 * it resolves the href itself via the shared pathname helpers, so it works
 * whether or not phase-2 router wiring has happened yet.
 *
 * Props are forwarded explicitly (not via object-rest or a missing
 * `splitProps`/`mergeProps` primitive — Solid 2 only exports `merge`) so
 * each one is read directly from `props` in JSX position and keeps its
 * per-key reactivity.
 */
export function LocalizedLink(props: LocalizedLinkProps): JSX.Element {
  const context = Solid.useContext(I18nContext);

  const href = Solid.createMemo(() =>
    localizePath(props.to, props.language ?? context.language(), {
      languages: [...context.languages],
      localisedUrls: context.localisedUrls,
    }),
  );

  return (
    <Link
      // `href` wins over `to` in router-core's `buildLocation` (it checks
      // `dest.href` first); `to="."` only satisfies the type-level
      // requirement that a `to` be present and is otherwise inert.
      to="."
      href={href()}
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
