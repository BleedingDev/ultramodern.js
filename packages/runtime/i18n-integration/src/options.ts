import type { LocalisedUrlsOption } from '@modern-js/i18n-runtime-extensions';
import type { I18nPluginOptions as NativeRuntimeOptions } from '@modern-js/plugin-i18n/runtime/no-react-i18next';

export type IntegratedLocaleDetectionOptions = NonNullable<
  NativeRuntimeOptions['localeDetection']
> & {
  localisedUrls?: LocalisedUrlsOption;
  localeDetectionByEntry?: Record<string, IntegratedLocaleDetectionOptions>;
};

export type I18nPluginOptions = NativeRuntimeOptions & {
  localeDetection?: IntegratedLocaleDetectionOptions;
};
