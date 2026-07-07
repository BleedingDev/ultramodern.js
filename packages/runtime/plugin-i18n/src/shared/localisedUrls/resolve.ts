import { normalisePathname } from './normalise';

import {
  buildPathFromPattern,
  matchPathPattern,
  sortPatternsBySpecificity,
} from './patterns';

import type { LocalisedUrlsMap } from './types';

export const resolveLocalisedPath = (
  pathname: string,
  targetLanguage: string,
  languages: string[],
  localisedUrls: LocalisedUrlsMap,
): string => {
  const normalizedPathname = normalisePathname(pathname);

  // Canonical keys take precedence: authors write language-agnostic paths,
  // which are the map keys, even when no language pattern equals the key.
  const canonicalCandidates = sortPatternsBySpecificity(
    Object.entries(localisedUrls).map(
      ([canonicalPattern, localisedUrlEntry]) => ({
        pattern: canonicalPattern,
        canonicalPattern,
        localisedUrlEntry,
      }),
    ),
  );

  for (const { canonicalPattern, localisedUrlEntry } of canonicalCandidates) {
    const targetPattern = localisedUrlEntry[targetLanguage];
    if (!targetPattern) {
      continue;
    }

    const params = matchPathPattern(normalizedPathname, canonicalPattern);
    if (params) {
      return buildPathFromPattern(targetPattern, params);
    }
  }

  const localisedCandidates = sortPatternsBySpecificity(
    Object.values(localisedUrls).flatMap(localisedUrlEntry => {
      const targetPattern = localisedUrlEntry[targetLanguage];
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

  return normalizedPathname;
};

/**
 * Reverse-map a language-specific pathname (without language prefix) back to
 * the canonical, language-agnostic path: localized slug patterns are matched
 * against every language variant and rebuilt from the canonical map key.
 */
export const resolveCanonicalLocalisedPath = (
  pathname: string,
  languages: string[],
  localisedUrls: LocalisedUrlsMap,
): string => {
  const normalizedPathname = normalisePathname(pathname);

  const canonicalCandidates = sortPatternsBySpecificity(
    Object.entries(localisedUrls).map(
      ([canonicalPattern, localisedUrlEntry]) => ({
        pattern: canonicalPattern,
        canonicalPattern,
        localisedUrlEntry,
      }),
    ),
  );

  for (const { canonicalPattern, localisedUrlEntry } of canonicalCandidates) {
    const canonicalParams = matchPathPattern(
      normalizedPathname,
      canonicalPattern,
    );
    if (canonicalParams) {
      return buildPathFromPattern(canonicalPattern, canonicalParams);
    }

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

  return normalizedPathname;
};
