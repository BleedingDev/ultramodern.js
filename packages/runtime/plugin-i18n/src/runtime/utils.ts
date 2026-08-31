import {
  type LocalisedUrlsOption,
  localiseTargetPathname,
  shouldSkipLocaleRedirect,
} from '@modern-js/i18n-runtime-extensions';
import { isBrowser } from '@modern-js/runtime';
import { getGlobalBasename } from '@modern-js/runtime/context';

// Structural parameter: hooks.ts passes a public-TRuntimeContext-based
// context while core.tsx passes the internal one; both carry the request
// pathname shape this helper needs.
export const getPathname = (context: {
  ssrContext?: { request?: { pathname?: string } };
}): string => {
  if (isBrowser()) {
    return window.location.pathname;
  }
  return context.ssrContext?.request?.pathname || '/';
};

export const getEntryPath = (): string => {
  const basename = getGlobalBasename();
  if (basename) {
    return basename === '/' ? '' : basename;
  }
  return '';
};
/**
 * Helper function to get language from current pathname
 * @param pathname - The current pathname
 * @param languages - Array of supported languages
 * @param fallbackLanguage - Fallback language when no language is detected
 * @returns The detected language or fallback language
 */
export const getLanguageFromPath = (
  pathname: string,
  languages: string[],
  fallbackLanguage: string,
): string => {
  const segments = pathname.split('/').filter(Boolean);
  const firstSegment = segments[0];

  if (languages.includes(firstSegment)) {
    return firstSegment;
  }

  return fallbackLanguage;
};

/**
 * Split a link target into its pathname, search and hash parts without
 * relying on `new URL` (SSR-hot path; targets are relative).
 */
export const splitUrlTarget = (
  target: string,
): { pathname: string; search: string; hash: string } => {
  const hashIndex = target.indexOf('#');
  const hash = hashIndex >= 0 ? target.slice(hashIndex) : '';
  const beforeHash = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
  const searchIndex = beforeHash.indexOf('?');
  const search = searchIndex >= 0 ? beforeHash.slice(searchIndex) : '';
  const pathname =
    searchIndex >= 0 ? beforeHash.slice(0, searchIndex) : beforeHash;

  return { pathname, search, hash };
};

/**
 * Helper function to build localized URL
 * @param target - The language-agnostic target; may include `?search` and `#hash`
 * @param language - The target language
 * @param languages - Array of supported languages
 * @returns The localized URL path with search and hash re-appended verbatim
 */
export const buildLocalizedUrl = (
  target: string,
  language: string,
  languages: string[],
  localisedUrls?: LocalisedUrlsOption,
): string => {
  const { pathname, search, hash } = splitUrlTarget(target);
  const localizedPathname = localiseTargetPathname(
    pathname,
    language,
    languages,
    localisedUrls,
  );

  return `${localizedPathname}${search}${hash}`;
};

export const detectLanguageFromPath = (
  pathname: string,
  languages: string[],
  localePathRedirect: boolean,
): {
  detected: boolean;
  language?: string;
} => {
  if (!localePathRedirect) {
    return { detected: false };
  }

  const entryPath = getEntryPath();
  const relativePath = pathname.replace(entryPath, '');
  const segments = relativePath.split('/').filter(Boolean);

  // If entryPath is empty and first segment is not a language,
  // it might be an entry path (e.g., /lang/en -> lang is entry, en is language)
  const segmentsToCheck =
    !entryPath &&
    segments.length > 1 &&
    segments[0] &&
    !languages.includes(segments[0])
      ? segments.slice(1) // Skip the first segment (entry path) and check the second segment
      : segments;

  const firstSegment = segmentsToCheck[0];

  if (firstSegment && languages.includes(firstSegment)) {
    return { detected: true, language: firstSegment };
  }

  return { detected: false };
};

/**
 * Check if the given pathname should ignore automatic locale redirect
 */
export const shouldIgnoreRedirect = (
  pathname: string,
  languages: string[],
  ignoreRedirectRoutes?: string[] | ((pathname: string) => boolean),
): boolean => {
  return shouldSkipLocaleRedirect(pathname, languages, ignoreRedirectRoutes);
};
