export { buildInitOptions, mergeDetectionOptions } from './initOptions';
export { cacheUserLanguage } from './middleware';
export { detectLanguageWithPriority } from './priority';
export { exportServerLngToWindow, getLanguageFromSSRData } from './ssr';
export type {
  BaseLanguageDetectionOptions,
  BuildInitOptionsParams,
  LanguageDetectionOptions,
  LanguageDetectionResult,
} from './types';
