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
 * The latest `changeLanguage` call per instance. Only it may navigate or
 * restore; an older call that settles later leaves the language to it.
 */
const languageSwitches = new WeakMap<
  object,
  { readonly generation: number; readonly language: string }
>();

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
    // The full href keeps the query and fragment across the language switch.
    const from = router.state.location.href;
    const href = localizePath(from, nextLanguage, {
      languages: [...languages],
      localisedUrls,
    });
    // A failed or blocked navigation leaves the page on its URL, so the
    // language returns to the one that URL renders, unless a later switch
    // has taken over.
    const restore = async () => {
      if (!current()) return;
      await instance.changeLanguage?.(previous);
      if (!current()) await converge();
    };
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
