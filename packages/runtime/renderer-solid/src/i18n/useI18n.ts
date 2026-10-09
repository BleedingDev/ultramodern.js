import { localizePath } from '@modern-js/i18n-runtime-extensions/paths';
import { languageFromPathname } from '@modern-js/i18n-runtime-extensions/request-language';
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
 * Language switches per instance run one at a time: a switch that a newer
 * one has superseded before it starts is skipped, so no two switches ever
 * interleave their language loads and navigations.
 */
const languageSwitches = new WeakMap<
  object,
  { latest: number; queue: Promise<void> }
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

  const changeLanguage = (requested: string): Promise<void> => {
    // Only a configured language has a locale prefix: i18next would fall back
    // silently and the URL would gain an unknown segment. An unsupported
    // request is rejected before it supersedes any queued switch.
    const nextLanguage = languages.find(
      language => language.toLowerCase() === String(requested).toLowerCase(),
    );
    if (nextLanguage === undefined)
      return Promise.reject(
        new RangeError(
          `Unsupported language "${requested}"; expected one of: ${languages.join(', ')}`,
        ),
      );
    const state = languageSwitches.get(instance) ?? {
      latest: 0,
      queue: Promise.resolve(),
    };
    languageSwitches.set(instance, state);
    const generation = ++state.latest;
    const run = state.queue.then(async () => {
      if (state.latest !== generation) return;
      // Earlier switches have settled, so this is the language the current
      // URL was committed with.
      const committed = instance.language;
      // The public URL carries the locale. Under the i18n URL rewrite the
      // router's own location is canonical and has none.
      const publicLanguage = () =>
        router
          ? languageFromPathname(
              new URL(router.state.location.publicHref, 'http://localhost')
                .pathname,
              languages,
              router.options.basepath,
            )
          : undefined;
      // A failed, blocked or redirected switch leaves the page on some URL;
      // the language follows that URL's locale, or the committed language on
      // a URL without one.
      const reconcile = async () => {
        const language = publicLanguage() ?? committed;
        if (instance.language !== language)
          await instance.changeLanguage?.(language);
      };
      try {
        await instance.changeLanguage?.(nextLanguage);
      } catch (error) {
        await reconcile();
        throw error;
      }
      if (!router) return;
      // The full href keeps the query and fragment across the language switch.
      const href = localizePath(router.state.location.href, nextLanguage, {
        languages: [...languages],
        localisedUrls,
      });
      try {
        await router.navigate({ to: '.', href, replace: true });
      } catch (error) {
        await reconcile();
        throw error;
      }
      if (publicLanguage() !== nextLanguage) await reconcile();
    });
    state.queue = run.catch(() => {});
    return run;
  };

  return { t, language, languages, instance, changeLanguage };
}
