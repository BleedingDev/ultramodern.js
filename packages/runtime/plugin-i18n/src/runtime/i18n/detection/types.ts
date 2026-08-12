import type { I18nInitOptions, LanguageDetectorOptions } from '../instance';

export interface LanguageDetectionSsrContext {
  request?: unknown;
}

export interface BaseLanguageDetectionOptions {
  languages: string[];
  fallbackLanguage: string;
  localePathRedirect: boolean;
  i18nextDetector: boolean;
  detection?: LanguageDetectorOptions;
  userInitOptions?: I18nInitOptions;
}

export interface LanguageDetectionOptions extends BaseLanguageDetectionOptions {
  pathname: string;
  ssrContext?: LanguageDetectionSsrContext;
}

export interface LanguageDetectionResult {
  detectedLanguage?: string;
  finalLanguage: string;
}
