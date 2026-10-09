import { localizePath } from '@modern-js/i18n-runtime-extensions/paths';
import { useContext } from 'octane';
import { useRouter } from '../router';
import { I18nContext } from './context';
import type { I18nInstanceLike } from './types';

export interface UseI18nReturn {
  t: I18nInstanceLike['t'];
  /** Current language. Re-renders the calling component on `languageChanged`. */
  language: string;
  languages: readonly string[];
  /** The raw per-request instance, for advanced use (namespaces, `exists`, ...). */
  instance: I18nInstanceLike;
  /**
   * Switches the i18next instance's language. With a router, also navigates to
   * the localized path so the URL and active language stay aligned.
   */
  changeLanguage: (language: string) => Promise<void>;
}

/**
 * The latest `changeLanguage` call per instance. Only it may navigate or
 * restore; an older call that settles later leaves the language to it.
 */
const languageSwitches = new WeakMap<
  object,
  { readonly generation: number; readonly language: string }
>();

/**
 * Must render under `I18nProvider`; throws rather than silently reading a
 * fallback instance when no provider is mounted (Octane's `createContext`
 * requires a default value, so `I18nContext`'s default is `null` and this
 * hook turns that into a loud error instead of a shared singleton).
 */
export function useI18n(): UseI18nReturn {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error(
      '[renderer-octane] useI18n() was called outside of an I18nProvider.',
    );
  }
  const { instance, languages, localisedUrls, language } = context;

  const t: I18nInstanceLike['t'] = (key, options) => instance.t(key, options);

  const router = useRouter({ warn: false });

  const changeLanguage = async (nextLanguage: string): Promise<void> => {
    const generation = (languageSwitches.get(instance)?.generation ?? 0) + 1;
    languageSwitches.set(instance, { generation, language: nextLanguage });
    const current = () =>
      languageSwitches.get(instance)?.generation === generation;
    const previous = instance.language;
    await instance.changeLanguage?.(nextLanguage);
    if (!current()) {
      // A slower load that finished last must not overwrite the newer target.
      const latest = languageSwitches.get(instance)?.language;
      if (latest !== undefined && instance.language !== latest)
        await instance.changeLanguage?.(latest);
      return;
    }
    if (!router) return;
    // The full href keeps the query and fragment across the language switch.
    const from = router.state.location.href;
    const href = localizePath(from, nextLanguage, {
      languages: [...languages],
      localisedUrls,
    });
    // A failed or blocked navigation leaves the page on its URL, so the
    // language returns to the one that URL renders, unless a later switch
    // has taken over.
    const restore = () =>
      current() ? instance.changeLanguage?.(previous) : undefined;
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
