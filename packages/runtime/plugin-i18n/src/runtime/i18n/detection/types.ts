import type {
  BackendOptions,
  I18nInitOptions,
  LanguageDetectorOptions,
} from '../instance';

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
  mergedBackend?: BackendOptions;
}

export interface LanguageDetectionOptions extends BaseLanguageDetectionOptions {
  pathname: string;
  ssrContext?: LanguageDetectionSsrContext;
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
  mergedDetection?: LanguageDetectorOptions;
  mergeBackend?: BackendOptions;
}
