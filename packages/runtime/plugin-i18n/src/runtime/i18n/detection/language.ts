/**
 * Normalize language code (e.g., 'zh-CN' -> 'zh', 'en-US' -> 'en')
 */
const normalizeLanguageCode = (language: string): string => {
  // Extract base language code (before hyphen)
  const baseLang = language.split('-')[0];
  return baseLang;
};

/**
 * Get the supported language that matches the given language
 * Returns the exact match if available, otherwise returns the base language code match
 * Returns undefined if no match is found
 */
export const getSupportedLanguage = (
  language: string | undefined,
  supportedLanguages: string[],
): string | undefined => {
  if (!language) {
    return undefined;
  }
  if (supportedLanguages.length === 0) {
    return language;
  }
  // Check exact match first
  if (supportedLanguages.includes(language)) {
    return language;
  }
  // Check base language code match (e.g., 'zh-CN' matches 'zh')
  const baseLang = normalizeLanguageCode(language);
  if (baseLang !== language && supportedLanguages.includes(baseLang)) {
    return baseLang;
  }
  return undefined;
};
