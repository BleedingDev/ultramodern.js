import { resolveLocalisedUrlsConfig } from './config';

import { resolveCanonicalLocalisedPath, resolveLocalisedPath } from './resolve';

import type { LocalisedUrlsOption } from './types';

const stripLanguagePrefix = (pathname: string, languages: string[]): string => {
  const segments = pathname.split('/').filter(Boolean);
  const firstSegment = segments[0]?.toLowerCase();

  if (
    firstSegment &&
    languages.some(language => language.toLowerCase() === firstSegment)
  ) {
    return `/${segments.slice(1).join('/')}`;
  }

  return pathname || '/';
};

export const localiseTargetPathname = (
  pathname: string,
  language: string,
  languages: string[],
  localisedUrls?: LocalisedUrlsOption,
): string => {
  const pathWithoutLanguage = stripLanguagePrefix(pathname, languages);
  const localisedUrlsConfig = resolveLocalisedUrlsConfig(localisedUrls);
  const resolvedPath = localisedUrlsConfig.enabled
    ? resolveLocalisedPath(
        pathWithoutLanguage,
        language,
        languages,
        localisedUrlsConfig.map,
      )
    : pathWithoutLanguage;
  const resolvedSegments = resolvedPath.split('/').filter(Boolean);

  return `/${[language, ...resolvedSegments].join('/')}`;
};

export const canonicalTargetPathname = (
  pathname: string,
  languages: string[],
  localisedUrls?: LocalisedUrlsOption,
): string => {
  const pathWithoutLanguage = stripLanguagePrefix(pathname, languages);
  const localisedUrlsConfig = resolveLocalisedUrlsConfig(localisedUrls);

  return localisedUrlsConfig.enabled
    ? resolveCanonicalLocalisedPath(
        pathWithoutLanguage,
        languages,
        localisedUrlsConfig.map,
      )
    : pathWithoutLanguage;
};
