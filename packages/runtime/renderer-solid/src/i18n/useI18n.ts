import { localizePath } from '@modern-js/i18n-runtime-extensions/paths';
import * as Solid from 'solid-js';
import { useNavigate, useRouter } from '../router';
import { I18nContext } from './context';
import type { I18nInstanceLike } from './types';

export interface UseI18nReturn {
  /** Reactive: re-evaluates when i18next fires `languageChanged`. */
  t: I18nInstanceLike['t'];
  /** Reactive current language accessor, shared with every other consumer. */
  language: Solid.Accessor<string>;
  languages: readonly string[];
  /** The raw per-request instance, for advanced use (namespaces, `exists`, ...). */
  instance: I18nInstanceLike;
  /**
   * Switches the i18next instance's language and navigates to the localized
   * path for the current location under the new language, so the URL and the
   * active language never disagree.
   */
  changeLanguage: (language: string) => Promise<void>;
}

/**
 * Must render under `I18nProvider`; `useContext` on the default-less
 * `I18nContext` throws `ContextNotFoundError` otherwise, rather than
 * silently reading a fallback instance. The reactive `language` signal lives
 * on the provider (one `languageChanged` subscription per request, shared by
 * every consumer) — this hook just reads it.
 */
export function useI18n(): UseI18nReturn {
  const context = Solid.useContext(I18nContext);
  const { instance, languages, localisedUrls, language } = context;

  const t: I18nInstanceLike['t'] = (key, options) => {
    // Read the signal so every consumer of `t` re-renders on language change,
    // even though `instance.t` itself is not reactive.
    language();
    return instance.t(key, options);
  };

  const router = useRouter();
  const navigate = useNavigate();

  const changeLanguage = async (nextLanguage: string): Promise<void> => {
    await instance.changeLanguage?.(nextLanguage);
    const currentPathname = router.state.location.pathname;
    const href = localizePath(currentPathname, nextLanguage, {
      languages: [...languages],
      localisedUrls,
    });
    await navigate({ to: '.', href, replace: true });
  };

  return { t, language, languages, instance, changeLanguage };
}
