import type { I18nInitOptions, LanguageDetectorOptions } from '../instance';

export interface BaseLanguageDetectionOptions {
  languages: string[];
  fallbackLanguage: string;
  localePathRedirect: boolean;
  i18nextDetector: boolean;
  detection?: LanguageDetectorOptions;
  userInitOptions?: I18nInitOptions;
  mergedBackend?: any;
}

export interface LanguageDetectionOptions extends BaseLanguageDetectionOptions {
  pathname: string;
  ssrContext?: any;
}

export interface LanguageDetectionResult {
  detectedLanguage?: string;
  finalLanguage: string;
}

/**
 * Options for building i18n init options
 */
export interface BuildInitOptionsParams {
  finalLanguage: string;
  fallbackLanguage: string;
  languages: string[];
  userInitOptions?: I18nInitOptions;
  mergedDetection?: any;
  mergeBackend?: any;
}
