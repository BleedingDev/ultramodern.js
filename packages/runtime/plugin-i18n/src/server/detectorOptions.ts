import {
  DEFAULT_I18NEXT_DETECTION_OPTIONS,
  mergeDetectionOptions,
} from '../runtime/i18n/detection/config.js';
import type { LanguageDetectorOptions } from '../runtime/i18n/instance';

/**
 * Convert i18next detection options to hono languageDetector options
 */
export const convertToHonoLanguageDetectorOptions = (
  languages: string[],
  fallbackLanguage: string,
  detectionOptions?: LanguageDetectorOptions,
) => {
  // Merge user detection options with defaults
  const mergedDetection = detectionOptions
    ? mergeDetectionOptions(detectionOptions)
    : DEFAULT_I18NEXT_DETECTION_OPTIONS;

  // Get detection order, excluding 'path' and browser-only detectors
  const order = (mergedDetection.order || []).filter(
    (item: string) =>
      !['path', 'localStorage', 'navigator', 'htmlTag', 'subdomain'].includes(
        item,
      ),
  );

  // If no order specified, use default server-side order
  const detectionOrder =
    order.length > 0 ? order : ['querystring', 'cookie', 'header'];

  // Determine caches option
  // hono languageDetector expects: false | "cookie"[] | undefined
  const caches: false | ['cookie'] | undefined =
    mergedDetection.caches === false
      ? false
      : Array.isArray(mergedDetection.caches) &&
          !mergedDetection.caches.includes('cookie')
        ? false
        : (['cookie'] as ['cookie']);

  const cookieMinutes = (mergedDetection as Record<string, unknown>)
    .cookieMinutes;
  const cookieMaxAge =
    typeof cookieMinutes === 'number' && Number.isFinite(cookieMinutes)
      ? Math.max(0, Math.floor(cookieMinutes * 60))
      : DEFAULT_I18NEXT_DETECTION_OPTIONS.cookieMinutes * 60;

  const cookieDomain = (mergedDetection as Record<string, unknown>)
    .cookieDomain;
  const cookieSecure = (mergedDetection as Record<string, unknown>)
    .cookieSecure;
  const cookieHttpOnly = (mergedDetection as Record<string, unknown>)
    .cookieHttpOnly;
  const cookieSameSite = (mergedDetection as Record<string, unknown>)
    .cookieSameSite;

  const normalizedCookieDomain =
    typeof cookieDomain === 'string' ? cookieDomain : undefined;

  // Keep cookie defaults aligned with i18next language detector behavior:
  // language cookie should be readable from browser-side detector.
  const cookieOptions = {
    maxAge: cookieMaxAge,
    sameSite:
      cookieSameSite === 'None' || cookieSameSite === 'none'
        ? ('None' as const)
        : cookieSameSite === 'Lax' || cookieSameSite === 'lax'
          ? ('Lax' as const)
          : ('Strict' as const),
    secure: typeof cookieSecure === 'boolean' ? cookieSecure : false,
    httpOnly: typeof cookieHttpOnly === 'boolean' ? cookieHttpOnly : false,
    ...(normalizedCookieDomain ? { domain: normalizedCookieDomain } : {}),
  };

  return {
    supportedLanguages: languages.length > 0 ? languages : [fallbackLanguage],
    fallbackLanguage,
    order: detectionOrder as ('querystring' | 'cookie' | 'header' | 'path')[],
    lookupQueryString:
      mergedDetection.lookupQuerystring ||
      DEFAULT_I18NEXT_DETECTION_OPTIONS.lookupQuerystring ||
      'lng',
    lookupCookie:
      mergedDetection.lookupCookie ||
      DEFAULT_I18NEXT_DETECTION_OPTIONS.lookupCookie ||
      'i18next',
    lookupFromHeaderKey:
      mergedDetection.lookupHeader ||
      DEFAULT_I18NEXT_DETECTION_OPTIONS.lookupHeader ||
      'accept-language',
    ...(caches !== undefined && { caches }),
    ...(caches !== false && { cookieOptions }),
    ignoreCase: true,
  };
};
