import { LanguageDetector } from 'i18next-http-middleware';
import type { I18nInstance, LanguageDetectorOptions } from '../instance';

type HttpDetectorInit = (
  services: NonNullable<I18nInstance['services']>,
  options?: unknown,
  allOptions?: unknown,
) => void;

type HttpDetectorDetect = (
  request: unknown,
  response: unknown,
  detectionOrder?: unknown,
) => string | string[] | undefined;

export const cacheUserLanguage = (
  _i18nInstance: I18nInstance,
  _language: string,
  _detectionOptions?: unknown,
): void => {
  return;
};

/**
 * Read language directly from storage (localStorage/cookie)
 * Not available in Node.js environment, returns undefined
 */
export const readLanguageFromStorage = (
  _detectionOptions?: LanguageDetectorOptions,
): string | undefined => {
  // In Node.js environment, storage-based detection is not available
  return undefined;
};
/**
 * Register LanguageDetector plugin to i18n instance
 * Must be called before init() to properly register the detector
 */
export const useI18nextLanguageDetector = (i18nInstance: I18nInstance) => {
  if (!i18nInstance.isInitialized) {
    return i18nInstance.use(LanguageDetector);
  }
  return i18nInstance;
};

/**
 * Detect language using i18next-http-middleware LanguageDetector
 * For initialized instances without detector in services, manually create a detector instance
 */
export const detectLanguage = (
  i18nInstance: I18nInstance,
  request?: unknown,
  detectionOptions?: LanguageDetectorOptions,
): string | undefined => {
  if (!request) {
    return undefined;
  }

  try {
    const detector = i18nInstance.services?.languageDetector;
    if (detector && typeof detector.detect === 'function') {
      const result = detector.detect(request, {});
      if (typeof result === 'string') {
        return result;
      }
      if (Array.isArray(result) && result.length > 0) {
        return result[0];
      }
      return undefined;
    }

    if (
      i18nInstance.isInitialized &&
      i18nInstance.services &&
      i18nInstance.options
    ) {
      const manualDetector = new LanguageDetector();
      const optionsToUse = detectionOptions
        ? { ...i18nInstance.options, detection: detectionOptions }
        : i18nInstance.options;
      (manualDetector.init as unknown as HttpDetectorInit)(
        i18nInstance.services,
        optionsToUse,
      );

      const result = (manualDetector.detect as unknown as HttpDetectorDetect)(
        request,
        {},
        undefined,
      );
      if (typeof result === 'string') {
        return result;
      }
      if (Array.isArray(result) && result.length > 0) {
        return result[0];
      }
      return undefined;
    }
  } catch (error) {
    return undefined;
  }

  return undefined;
};
