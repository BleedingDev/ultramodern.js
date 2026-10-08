import {
  canonicalTargetPathname,
  type LocalisedUrlsOption,
  localiseTargetPathname,
} from '@modern-js/runtime-extensions/localised-urls';
import { languageFromPathname } from './requestLanguage';

/**
 * Structurally identical to `@tanstack/router-core`'s `LocationRewriteFunction`.
 * Defined locally so this module has no runtime dependency on router-core —
 * any router built on that contract (TanStack Router, `@octanejs/tanstack-router`,
 * which re-exports it verbatim) can consume the rewrite this module builds.
 */
export type I18nLocationRewriteFunction = (args: {
  url: URL;
}) => undefined | string | URL;

/** Structurally identical to `@tanstack/router-core`'s `LocationRewrite`. */
export interface I18nLocationRewrite {
  input?: I18nLocationRewriteFunction;
  output?: I18nLocationRewriteFunction;
}

export interface CreateI18nUrlRewriteOptions {
  /** Supported language codes, e.g. `['en', 'cs']`. */
  languages: readonly string[];
  /**
   * The language an outgoing (internal -> public) location is localized to
   * when its pathname does not already start with a supported language.
   */
  getLanguage: () => string;
  /**
   * Canonical-path -> per-language path map; mirrors
   * `localeDetection.localisedUrls`. Omit for the plain language-prefix policy.
   */
  localisedUrls?: LocalisedUrlsOption;
  /**
   * Called with the language segment found in an incoming public pathname,
   * before it is stripped to its canonical form. Not called when the
   * pathname carries no recognizable language segment.
   */
  onLanguageDetected?: (language: string) => void;
}

/**
 * Build a TanStack router-core `LocationRewrite` from the fork's localized-URL
 * pathname helpers: the router matches against canonical (language-agnostic)
 * paths internally, while every public href it produces carries the current
 * language prefix (and any mapped locale slug). An outgoing pathname that
 * already starts with a supported language keeps that language, which is how
 * a route mask such as `LocalizedLink`'s publishes another language's URL.
 *
 * Pass the result directly as a router's `rewrite` option:
 *
 * ```ts
 * createRouter({ routeTree, rewrite: createI18nUrlRewrite({ languages, getLanguage }) })
 * ```
 *
 * If the router also configures a `basepath`, router-core composes the two
 * for you — its constructor internally does
 * `this.rewrite = rewriteBasepath(basepath, caseSensitive, options.rewrite)`
 * (that helper is an internal, not part of router-core's public exports; the
 * composition happens automatically, nothing extra to call here). It strips
 * the basepath before this rewrite's `input` runs, and applies this
 * rewrite's `output` before the basepath is re-added, so the public URL
 * shape is `${basepath}${languagePrefix}${canonicalPath}` — e.g.
 * `/app/en/dashboard` while the router itself only ever sees `/dashboard`.
 */
export const createI18nUrlRewrite = (
  options: CreateI18nUrlRewriteOptions,
): I18nLocationRewrite => {
  const { languages, getLanguage, localisedUrls, onLanguageDetected } = options;
  const languageList = [...languages];

  return {
    input: ({ url }) => {
      const pathname = url.pathname;
      if (onLanguageDetected) {
        const segments = pathname.split('/').filter(Boolean);
        const firstSegment = segments[0];
        const detected = firstSegment
          ? languageList.find(
              language => language.toLowerCase() === firstSegment.toLowerCase(),
            )
          : undefined;
        if (detected) {
          onLanguageDetected(detected);
        }
      }
      url.pathname = canonicalTargetPathname(
        pathname,
        languageList,
        localisedUrls,
      );
      return url;
    },
    output: ({ url }) => {
      url.pathname = localiseTargetPathname(
        url.pathname,
        languageFromPathname(url.pathname, languageList) ?? getLanguage(),
        languageList,
        localisedUrls,
      );
      return url;
    },
  };
};
