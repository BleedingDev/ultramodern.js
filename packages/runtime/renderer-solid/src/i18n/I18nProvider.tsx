import type { JSX } from '@solidjs/web';
import * as Solid from 'solid-js';
import { I18nContext } from './context';
import type { I18nContextValue } from './types';

export interface I18nProviderProps extends Omit<I18nContextValue, 'language'> {
  children: JSX.Element;
}

/**
 * Provides a per-request i18next-shaped instance to the Solid tree. The
 * instance must come from the caller (created with `cloneInstance` per
 * request on the server, and the same instance reused on hydration) — this
 * provider holds no module-level state of its own beyond the one reactive
 * `language` signal it derives from `instance` and shares with every
 * consumer through context (see `I18nContextValue.language`'s doc for why
 * that single shared subscription matters, instead of each consumer
 * subscribing to `languageChanged` independently).
 *
 * In Solid 2 a `Context` doubles as its own provider component: `value` is
 * read reactively off `props` here, so an ancestor re-rendering this
 * provider with a new `instance`/`languages`/`localisedUrls` propagates
 * without needing a `.Provider` subcomponent.
 */
export function I18nProvider(props: I18nProviderProps): JSX.Element {
  const [language, setLanguage] = Solid.createSignal(props.instance.language);

  Solid.createEffect(
    () => props.instance,
    instance => {
      setLanguage(instance.language);
      const handleLanguageChanged = (lng: string) => setLanguage(lng);
      instance.on?.('languageChanged', handleLanguageChanged);
      Solid.onCleanup(() => {
        instance.off?.('languageChanged', handleLanguageChanged);
      });
    },
  );

  const value: I18nContextValue = {
    get instance() {
      return props.instance;
    },
    get languages() {
      return props.languages;
    },
    get localisedUrls() {
      return props.localisedUrls;
    },
    language,
  };

  return <I18nContext value={value}>{props.children}</I18nContext>;
}
