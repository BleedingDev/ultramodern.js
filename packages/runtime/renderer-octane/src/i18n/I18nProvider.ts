import { createElement, useEffect, useState } from 'octane';
import { I18nContext } from './context';
import type { I18nContextValue, I18nInstanceLike } from './types';

export interface I18nProviderProps extends Omit<I18nContextValue, 'language'> {
  children?: unknown;
}

/**
 * Provides a per-request i18next-shaped instance to the Octane tree. The
 * instance must come from the caller (created with `cloneInstance` per
 * request on the server, and the same instance reused on hydration) — this
 * provider holds no module-level state of its own beyond the one reactive
 * `language` state it derives from `instance` and shares with every
 * consumer through context, matching `@modern-js/plugin-i18n`'s React
 * `ModernI18nProvider` shape (one subscription, pushed through context,
 * rather than every consumer subscribing to `languageChanged` itself).
 *
 * No JSX: built with `createElement`, matching this package's existing
 * style (see `src/routes.ts`), and avoiding any dependency on Octane's
 * JSX/compiler toolchain for a file that needs none of its features.
 */
export function I18nProvider(props: I18nProviderProps) {
  const [language, setLanguage] = useState(() => props.instance.language);

  useEffect(() => {
    const instance: I18nInstanceLike = props.instance;
    setLanguage(instance.language);
    const handleLanguageChanged = (lng: string) => setLanguage(lng);
    instance.on?.('languageChanged', handleLanguageChanged);
    return () => {
      instance.off?.('languageChanged', handleLanguageChanged);
    };
  }, [props.instance]);

  const value: I18nContextValue = {
    instance: props.instance,
    languages: props.languages,
    localisedUrls: props.localisedUrls,
    language,
  };

  return createElement(I18nContext, { value, children: props.children });
}
