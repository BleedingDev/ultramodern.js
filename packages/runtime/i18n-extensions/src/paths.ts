import {
  canonicalTargetPathname,
  type LocalisedUrlsOption,
  localiseTargetPathname,
} from '@modern-js/runtime-extensions/localised-urls';
import { splitUrlTarget } from '@modern-js/runtime-utils/url';

export type { LocalisedUrlsOption };

export interface LocalizedPathsConfig {
  languages: string[];
  localisedUrls?: LocalisedUrlsOption;
}

/**
 * The configured spelling of a requested language, matched case-insensitively.
 * Only a configured language has a locale prefix, so anything else throws
 * rather than becoming an unknown path segment.
 */
export const configuredLanguage = (
  requested: string,
  languages: readonly string[],
): string => {
  const language = languages.find(
    candidate => candidate.toLowerCase() === String(requested).toLowerCase(),
  );
  if (language === undefined)
    throw new RangeError(
      `Unsupported language "${requested}"; expected one of: ${languages.join(', ')}`,
    );
  return language;
};

/** Synchronous mapped URL construction, independent of React/plugin setup. */
export const buildLocalizedUrl = (
  target: string,
  language: string,
  languages: string[],
  localisedUrls?: LocalisedUrlsOption,
): string => {
  const { pathname, search, hash } = splitUrlTarget(target);
  return `${localiseTargetPathname(pathname, language, languages, localisedUrls)}${search}${hash}`;
};

export const localizePath = (
  target: string,
  language: string,
  config: LocalizedPathsConfig,
): string =>
  buildLocalizedUrl(target, language, config.languages, config.localisedUrls);

export const canonicalPath = (
  target: string,
  config: LocalizedPathsConfig,
): string => {
  const { pathname, search, hash } = splitUrlTarget(target);
  return `${canonicalTargetPathname(pathname, config.languages, config.localisedUrls)}${search}${hash}`;
};
