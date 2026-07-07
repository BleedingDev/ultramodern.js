import { type I18nInstance, isI18nWrapperInstance } from '../instance';

import { detectLanguageFromI18nextDetector } from './detector';

import { mergeDetectionOptions } from './initOptions';
import { readLanguageFromStorage } from './middleware';
import { detectLanguageFromPathPriority } from './path';
import { detectLanguageFromSSR } from './ssr';

import type {
  LanguageDetectionOptions,
  LanguageDetectionResult,
} from './types';

/**
 * Detect language with priority:
 * Priority 1: SSR data (try window._SSR_DATA first, works for both SSR and CSR)
 * Priority 2: Path detection
 * Priority 3: i18next detector (reads from cookie/localStorage)
 * Priority 4: User config language or fallback
 */
export const detectLanguageWithPriority = async (
  i18nInstance: I18nInstance,
  options: LanguageDetectionOptions,
): Promise<LanguageDetectionResult> => {
  const {
    languages,
    fallbackLanguage,
    localePathRedirect,
    i18nextDetector,
    detection,
    userInitOptions,
    pathname,
    ssrContext,
  } = options;

  let detectedLanguage: string | undefined;

  // Priority 1: Try SSR data first (works for both SSR and CSR projects)
  // For CSR projects, if SSR data exists in window, use it; otherwise continue to next priority
  detectedLanguage = detectLanguageFromSSR(languages);

  // Priority 2: Path detection
  if (!detectedLanguage) {
    detectedLanguage = detectLanguageFromPathPriority(
      pathname,
      languages,
      localePathRedirect,
    );
  }

  // Priority 3: i18next detector (reads from cookie/localStorage)
  if (!detectedLanguage && i18nextDetector) {
    if (isI18nWrapperInstance(i18nInstance)) {
      detectedLanguage = readLanguageFromStorage(
        mergeDetectionOptions(
          i18nextDetector,
          detection,
          localePathRedirect,
          userInitOptions,
        ),
      );
    } else {
      detectedLanguage = await detectLanguageFromI18nextDetector(i18nInstance, {
        languages,
        fallbackLanguage,
        localePathRedirect,
        i18nextDetector,
        detection,
        userInitOptions,
        mergedBackend: options.mergedBackend,
        ssrContext,
      });
    }
  }

  // Priority 4: Use user config language or fallback
  const finalLanguage =
    detectedLanguage || userInitOptions?.lng || fallbackLanguage;

  return { detectedLanguage, finalLanguage };
};
