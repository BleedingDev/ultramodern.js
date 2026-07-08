import { normalisePathname } from './normalise';

import {
  buildPathFromPattern,
  matchPathPattern,
  sortPatternsBySpecificity,
} from './patterns';

import type { LocalisedUrlsMap } from './types';

type CanonicalCandidate = {
  pattern: string;
  canonicalPattern: string;
  localisedUrlEntry: LocalisedUrlsMap[string];
};

type ResolveLocalisedUrlPathOptions =
  | {
      mode: 'localised';
      targetLanguage: string;
    }
  | {
      mode: 'canonical';
    };

const getCanonicalCandidates = (
  localisedUrls: LocalisedUrlsMap,
): CanonicalCandidate[] =>
  sortPatternsBySpecificity(
    Object.entries(localisedUrls).map(
      ([canonicalPattern, localisedUrlEntry]) => ({
        pattern: canonicalPattern,
        canonicalPattern,
        localisedUrlEntry,
      }),
    ),
  );

const resolveLocalisedUrlPath = (
  pathname: string,
  languages: string[],
  localisedUrls: LocalisedUrlsMap,
  options: ResolveLocalisedUrlPathOptions,
): string => {
  const normalizedPathname = normalisePathname(pathname);
  const canonicalCandidates = getCanonicalCandidates(localisedUrls);

  for (const { canonicalPattern, localisedUrlEntry } of canonicalCandidates) {
    const targetPattern =
      options.mode === 'localised'
        ? localisedUrlEntry[options.targetLanguage]
        : canonicalPattern;

    if (!targetPattern) {
      continue;
    }

    const canonicalParams = matchPathPattern(
      normalizedPathname,
      canonicalPattern,
    );
    if (canonicalParams) {
      return buildPathFromPattern(targetPattern, canonicalParams);
    }

    if (options.mode === 'canonical') {
      for (const language of languages) {
        const sourcePattern = localisedUrlEntry[language];
        if (!sourcePattern) {
          continue;
        }

        const params = matchPathPattern(normalizedPathname, sourcePattern);
        if (params) {
          return buildPathFromPattern(canonicalPattern, params);
        }
      }
    }
  }

  if (options.mode === 'localised') {
    const localisedCandidates = sortPatternsBySpecificity(
      Object.values(localisedUrls).flatMap(localisedUrlEntry => {
        const targetPattern = localisedUrlEntry[options.targetLanguage];
        if (!targetPattern) {
          return [];
        }

        return languages
          .map(language => localisedUrlEntry[language])
          .filter((sourcePattern): sourcePattern is string =>
            Boolean(sourcePattern),
          )
          .map(sourcePattern => ({
            pattern: sourcePattern,
            sourcePattern,
            targetPattern,
          }));
      }),
    );

    for (const { sourcePattern, targetPattern } of localisedCandidates) {
      const params = matchPathPattern(normalizedPathname, sourcePattern);
      if (params) {
        return buildPathFromPattern(targetPattern, params);
      }
    }
  }

  return normalizedPathname;
};

export const resolveLocalisedPath = (
  pathname: string,
  targetLanguage: string,
  languages: string[],
  localisedUrls: LocalisedUrlsMap,
): string =>
  resolveLocalisedUrlPath(pathname, languages, localisedUrls, {
    mode: 'localised',
    targetLanguage,
  });

/**
 * Reverse-map language-specific pathnames back to language-agnostic
 * LocalisedUrlsMap keys.
 */
export const resolveCanonicalLocalisedPath = (
  pathname: string,
  languages: string[],
  localisedUrls: LocalisedUrlsMap,
): string =>
  resolveLocalisedUrlPath(pathname, languages, localisedUrls, {
    mode: 'canonical',
  });
