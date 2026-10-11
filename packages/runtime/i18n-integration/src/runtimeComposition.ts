import {
  I18nRouterNavigationProvider,
  type I18nPluginOptions as NativeI18nPluginOptions,
} from '@modern-js/plugin-i18n/runtime/no-react-i18next';
import type { RuntimePlugin } from '@modern-js/runtime';
import { registerFederatedI18nBoundary } from './federation/registration';
import { I18nLanguageSynchronization } from './languageSynchronization';
import type { I18nPluginOptions } from './options';
import { createI18nUrlStrategy } from './urlStrategy';

export const composeI18nPlugin =
  (nativeI18nPlugin: (options: NativeI18nPluginOptions) => RuntimePlugin) =>
  (options: I18nPluginOptions = {}): RuntimePlugin => {
    const {
      localisedUrls,
      localeDetectionByEntry: _entryOptions,
      ...nativeLocaleDetection
    } = options.localeDetection ?? {};
    const native = nativeI18nPlugin({
      ...options,
      localeDetection: nativeLocaleDetection,
      urlStrategy: options.urlStrategy ?? createI18nUrlStrategy(localisedUrls),
      NavigationProvider:
        options.NavigationProvider ?? I18nRouterNavigationProvider,
      LanguageSynchronization:
        options.LanguageSynchronization ?? I18nLanguageSynchronization,
    });
    return {
      ...native,
      setup(api) {
        registerFederatedI18nBoundary(api);
        return native.setup?.(api);
      },
    };
  };
