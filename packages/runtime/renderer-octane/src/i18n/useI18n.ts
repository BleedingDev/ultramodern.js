import { localizePath } from '@modern-js/i18n-runtime-extensions/paths';
import { useContext } from 'octane';
import { useNavigate, useRouter } from '../router';
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
   * Switches the i18next instance's language and navigates to the localized
   * path for the current location under the new language, so the URL and the
   * active language never disagree.
   */
  changeLanguage: (language: string) => Promise<void>;
}

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
