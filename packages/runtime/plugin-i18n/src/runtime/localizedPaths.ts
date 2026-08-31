import {
  canonicalTargetPathname,
  type LocalisedUrlsOption,
} from '@modern-js/i18n-runtime-extensions';
import { useMemo } from 'react';
import { useModernI18n } from './context';
import { useI18nRouterAdapter } from './routerAdapter';
import { buildLocalizedUrl, splitUrlTarget } from './utils';

export interface LocalizedPathsConfig {
  languages: string[];
  localisedUrls?: LocalisedUrlsOption;
}

/**
 * Localize a canonical, language-agnostic target for the given language:
 * adds the language prefix and applies `localisedUrls` pattern mapping.
 * `?search`/`#hash` suffixes are preserved verbatim.
 */
export const localizePath = (
  pathname: string,
  language: string,
  config: LocalizedPathsConfig,
): string =>
  buildLocalizedUrl(pathname, language, config.languages, config.localisedUrls);

/**
 * Reverse of {@link localizePath}: strip the language prefix and map localized
 * slugs back to the canonical pattern's path. `?search`/`#hash` suffixes are
 * preserved verbatim.
 */
export const canonicalPath = (
  target: string,
  config: LocalizedPathsConfig,
): string => {
  const { pathname, search, hash } = splitUrlTarget(target);
  const resolvedPath = canonicalTargetPathname(
    pathname,
    config.languages,
    config.localisedUrls,
  );

  return `${resolvedPath}${search}${hash}`;
};

export interface UseLocalizedPathsReturn {
  localizePath: (pathname: string, language: string) => string;
  canonicalPath: (pathname: string) => string;
}

/**
 * Context-bound versions of {@link localizePath} and {@link canonicalPath} —
 * the plugin configuration (languages, localisedUrls) is read from the i18n
 * provider, so apps never copy pattern-matching helpers again.
 */
export const useLocalizedPaths = (): UseLocalizedPathsReturn => {
  const { supportedLanguages, localisedUrls } = useModernI18n();

  return useMemo(() => {
    const config: LocalizedPathsConfig = {
      languages: supportedLanguages,
      localisedUrls,
    };

    return {
      localizePath: (pathname: string, language: string) =>
        localizePath(pathname, language, config),
      canonicalPath: (pathname: string) => canonicalPath(pathname, config),
    };
  }, [supportedLanguages, localisedUrls]);
};

export interface UseLocalizedLocationReturn {
  language: string;
  /** Canonical (language-agnostic) path of the current location. */
  canonical: string;
  /** Per-language hrefs for the current location, search+hash preserved. */
  alternates: Record<string, string>;
}

/**
 * Per-language hrefs for the current location — for hreflang `<link>` tags and
 * language switchers. SSR-safe: the location comes from the router adapter.
 */
export const useLocalizedLocation = (): UseLocalizedLocationReturn => {
  const { language, supportedLanguages, localisedUrls } = useModernI18n();
  const { location } = useI18nRouterAdapter();
  const pathname = location?.pathname ?? '/';
  const search = location?.search ?? '';
  const hash = location?.hash ?? '';

  return useMemo(() => {
    const config: LocalizedPathsConfig = {
      languages: supportedLanguages,
      localisedUrls,
    };
    const alternates: Record<string, string> = {};
    for (const supportedLanguage of supportedLanguages) {
      alternates[supportedLanguage] =
        `${localizePath(pathname, supportedLanguage, config)}${search}${hash}`;
    }

    return {
      language,
      canonical: canonicalPath(pathname, config),
      alternates,
    };
  }, [language, supportedLanguages, localisedUrls, pathname, search, hash]);
};
