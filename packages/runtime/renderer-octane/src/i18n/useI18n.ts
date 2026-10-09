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
 * The settlement of each instance's latest navigation. Switches navigate in
 * call order, so the newest switch's URL is always committed last.
 */
const languageNavigations = new WeakMap<object, Promise<void>>();

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
    // A slower load, or a restore, that settles after a newer switch must
    // not leave the instance behind it: converge on the newest target,
    // rechecking after each correction, and apply each switch at most once.
    const converge = async () => {
      let applied: number | undefined;
      for (
        let latest = languageSwitches.get(instance);
        latest &&
        latest.generation !== applied &&
        instance.language !== latest.language;
        latest = languageSwitches.get(instance)
      ) {
        applied = latest.generation;
        await instance.changeLanguage?.(latest.language);
      }
    };
    if (!current()) return converge();
    if (!router) return;
    const localizeHref = (href: string, language: string) =>
      localizePath(href, language, {
        languages: [...languages],
        localisedUrls,
      });
    // A failed, blocked or redirected navigation leaves the page on another
    // URL, so the language follows that URL, unless a later switch has taken
    // over.
    // The language the current URL renders, read after earlier switches'
    // navigations settled; the call's own snapshot only backs it up.
    const urlLanguage = () => {
      const href = router.state.location.href;
      return (
        languages.find(language => localizeHref(href, language) === href) ??
        previous
      );
    };
    const restore = async () => {
      if (!current()) return;
      // Retire the blocked target, so an older call that settles later
      // converges on the restored language instead.
      const restored = urlLanguage();
      languageSwitches.set(instance, { generation, language: restored });
      await instance.changeLanguage?.(restored);
      if (!current()) await converge();
    };
    const prior = languageNavigations.get(instance);
    let settle!: () => void;
    languageNavigations.set(
      instance,
      new Promise<void>(resolve => {
        settle = resolve;
      }),
    );
    try {
      await prior;
      if (!current()) return converge();
      // The full href keeps the query and fragment across the language switch.
      const from = router.state.location.href;
      const href = localizeHref(from, nextLanguage);
      try {
        await router.navigate({ to: '.', href, replace: true });
      } catch (error) {
        await restore();
        throw error;
      }
      // A blocked or redirected navigation settles on another URL; the
      // language follows the URL it settled on.
      if (router.state.location.href !== href) await restore();
      if (!current()) await converge();
    } finally {
      settle();
    }
  };

  return { t, language, languages, instance, changeLanguage };
}
