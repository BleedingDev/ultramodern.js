import { detectLanguageFromPath } from '../../utils';

/**
 * Priority 2: Detect language from URL path
 * Only returns a language if the path explicitly contains a language prefix
 */
export const detectLanguageFromPathPriority = (
  pathname: string,
  languages: string[],
  localePathRedirect: boolean,
): string | undefined => {
  if (!localePathRedirect) {
    return undefined;
  }

  // If no languages are configured, cannot detect from path
  if (!languages || languages.length === 0) {
    return undefined;
  }

  // If pathname is empty or invalid, no language in path
  if (!pathname || pathname.trim() === '') {
    return undefined;
  }

  try {
    const pathDetection = detectLanguageFromPath(
      pathname,
      languages,
      localePathRedirect,
    );
    // Only return language if explicitly detected in path
    if (pathDetection.detected === true && pathDetection.language) {
      return pathDetection.language;
    }
  } catch (error) {
    // Silently ignore errors, return undefined
  }

  return undefined;
};
