import type { LocalisedUrlsOption } from '@modern-js/runtime-extensions/localised-urls';

/**
 * The slice of an i18next-shaped instance this binding needs. Deliberately
 * not `@modern-js/plugin-i18n`'s `I18nInstance`: that type is intentionally
 * narrowed (no index signature, non-overloaded methods — see plugin-i18n's
 * fork notes) and, more importantly, the plugin package's peer dependencies
 * require React/ReactDOM, which a Solid-only application must never need to
 * install. `on`/`off` are real i18next `EventEmitter` methods this interface
 * adds back for the reactive `languageChanged` subscription.
 */
export interface I18nInstanceLike {
  language: string;
  t(key: string | string[], options?: Record<string, unknown>): string;
  changeLanguage?(lng?: string): Promise<unknown> | unknown;
  on?(event: 'languageChanged', callback: (lng: string) => void): void;
  off?(event: 'languageChanged', callback: (lng: string) => void): void;
  /** SSR per-request isolation: the server clones a base instance per request. */
  cloneInstance?(options?: Record<string, unknown>): I18nInstanceLike;
}

export interface I18nContextValue {
  /** Per-request instance. Never a module-level singleton. */
  instance: I18nInstanceLike;
  languages: readonly string[];
  localisedUrls?: LocalisedUrlsOption;
  /**
   * Reactive current language, owned by `I18nProvider`. Every consumer
   * (`useI18n`, `LocalizedLink`) reads this single shared signal rather than
   * each subscribing to `instance`'s `languageChanged` event independently —
   * `instance.language` is a plain mutable field, not itself reactive, so
   * reading it directly would silently never update a Solid computation.
   */
  language: () => string;
}
