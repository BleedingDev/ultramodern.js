import { isBrowser, type TRuntimeContext } from '@modern-js/runtime';
import { getSupportedLanguage } from './language';

export function exportServerLngToWindow(context: TRuntimeContext, lng: string) {
  context.__i18nData__ = { lng };
}

export const getLanguageFromSSRData = (window: Window): string | undefined => {
  try {
    const ssrData = (window as any)._SSR_DATA;
    // Check if SSR data exists and has valid structure
    if (!ssrData || !ssrData.data || !ssrData.data.i18nData) {
      return undefined;
    }
    const lng = ssrData.data.i18nData.lng;
    // Return language only if it's a non-empty string
    return typeof lng === 'string' && lng.trim() !== '' ? lng : undefined;
  } catch (error) {
    // If accessing window._SSR_DATA throws an error, return undefined
    return undefined;
  }
};

/**
 * Priority 1: Detect language from SSR data
 * Try to get language from window._SSR_DATA first (both SSR and CSR projects)
 * Returns undefined if SSR data is not available or invalid
 */
export const detectLanguageFromSSR = (
  languages: string[],
): string | undefined => {
  if (!isBrowser()) {
    return undefined;
  }

  try {
    const ssrLanguage = getLanguageFromSSRData(window);
    const supportedLanguage = getSupportedLanguage(ssrLanguage, languages);
    if (supportedLanguage) {
      return supportedLanguage;
    }
  } catch (error) {
    // Silently ignore errors
  }

  return undefined;
};
