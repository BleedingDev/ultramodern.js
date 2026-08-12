import type { I18nInitOptions, LanguageDetectorOptions } from '../instance';

import { mergeDetectionOptions as mergeDetectionOptionsUtil } from './config';

/**
 * Merge detection and backend options
 */
export const mergeDetectionOptions = (
  i18nextDetector: boolean,
  detection?: LanguageDetectorOptions,
  localePathRedirect?: boolean,
  userInitOptions?: I18nInitOptions,
) => {
  // Exclude 'path' from detection order to avoid conflict with manual path detection
  let mergedDetection: LanguageDetectorOptions;
  if (i18nextDetector) {
    // mergeDetectionOptionsUtil always returns an object with default options
    mergedDetection = mergeDetectionOptionsUtil(
      detection,
      userInitOptions?.detection,
    );
  } else {
    // If detector is disabled, use user options or empty object
    mergedDetection = userInitOptions?.detection || {};
  }

  // Ensure mergedDetection is always an object (should not be undefined after above)
  if (!mergedDetection || typeof mergedDetection !== 'object') {
    mergedDetection = {};
  }

  if (localePathRedirect && mergedDetection.order) {
    mergedDetection.order = mergedDetection.order.filter(
      (item: string) => item !== 'path',
    );
  }

  return mergedDetection;
};
