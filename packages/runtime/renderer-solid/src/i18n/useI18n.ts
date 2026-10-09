import { localizePath } from '@modern-js/i18n-runtime-extensions/paths';
import * as Solid from 'solid-js';
import { useRouter } from '../router';
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
   * Switches the i18next instance's language. Inside a router, also replaces
   * the current URL with the localized path for the new language.
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

  const router = useRouter({ warn: false });

  const changeLanguage = async (nextLanguage: string): Promise<void> => {
    const previous = instance.language;
    await instance.changeLanguage?.(nextLanguage);
    if (!router) return;
    // The full href keeps the query and fragment across the language switch.
    const from = router.state.location.href;
    const href = localizePath(from, nextLanguage, {
      languages: [...languages],
      localisedUrls,
    });
    // A failed or blocked navigation leaves the page on its URL, so the
    // language returns to the one that URL renders.
    const restore = () => instance.changeLanguage?.(previous);
    try {
      await router.navigate({ to: '.', href, replace: true });
    } catch (error) {
      await restore();
      throw error;
    }
    if (href !== from && router.state.location.href === from) await restore();
  };

  return { t, language, languages, instance, changeLanguage };
}
