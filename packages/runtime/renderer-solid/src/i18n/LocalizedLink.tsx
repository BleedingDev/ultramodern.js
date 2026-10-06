import {
  canonicalPath,
  localizePath,
} from '@modern-js/i18n-runtime-extensions/paths';
import type { JSX } from '@solidjs/web';
import * as Solid from 'solid-js';
import {
  Link,
  type LinkComponentProps,
  useLocation,
  useNavigate,
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
 * works with or without the router's i18n `rewrite`.
 *
 * A link to another language cannot go through the router alone: the i18n
 * `rewrite` localizes every outgoing location to the *current* language. It
 * renders a plain anchor (correct href for crawlers and new tabs) whose click
 * first switches the i18next language and then navigates client-side, the
 * same order `useI18n().changeLanguage` uses.
 *
 * Props are forwarded explicitly (not via object-rest or a missing
 * `splitProps`/`mergeProps` primitive — Solid 2 only exports `merge`) so
 * each one is read directly from `props` in JSX position and keeps its
 * per-key reactivity.
 */
export function LocalizedLink(props: LocalizedLinkProps): JSX.Element {
  const context = Solid.useContext(I18nContext);
  const router = useRouter();
  const navigate = useNavigate();

  const targetLanguage = () => props.language ?? context.language();
  const href = Solid.createMemo(() =>
    localizePath(props.to, targetLanguage(), {
      languages: [...context.languages],
      localisedUrls: context.localisedUrls,
    }),
  );
  const crossLanguage = () => targetLanguage() !== context.language();
  const documentHref = () => {
    const basepath = router.options.basepath ?? '/';
    return basepath === '/'
      ? href()
      : `${basepath.replace(/\/$/u, '')}${href()}`;
  };
  const switchLanguage = async (event: MouseEvent) => {
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
    const language = targetLanguage();
    const target = href();
    await context.instance.changeLanguage?.(language);
    await navigate({ to: '.', href: target, replace: props.replace });
  };

  return (
    <Solid.Show
      when={crossLanguage()}
      fallback={
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
      }
    >
      <a
        href={documentHref()}
        hreflang={targetLanguage()}
        class={props.class}
        onClick={event => void switchLanguage(event)}
      >
        {props.children as JSX.Element}
      </a>
    </Solid.Show>
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
