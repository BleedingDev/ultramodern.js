import type { RuntimePlugin } from '@modern-js/runtime';
import type React from 'react';
import type {
  BaseBackendOptions,
  BaseLocaleDetectionOptions,
} from '../shared/type';
import type { I18nInitOptions, I18nInstance } from './i18n';
import {
  type RuntimeContextWithI18n,
  setupI18nBeforeRender,
} from './pluginSetup';
import { createI18nRootWrapper } from './providerComposition';
import {
  type LoadReactI18nextIntegration,
  resolveReactI18nextIntegration,
} from './reactI18next';
import './types';

export type { I18nSdkLoader, I18nSdkLoadOptions } from '../shared/type';
export type {
  I18nInitOptions,
  I18nInstance,
  Resources,
  TranslateFn,
} from './i18n/instance';
export type {
  LoadReactI18nextIntegration,
  ReactI18nextIntegration,
} from './reactI18next';

export interface I18nPluginOptions {
  entryName?: string;
  localeDetection?: BaseLocaleDetectionOptions;
  backend?: BaseBackendOptions;
  i18nInstance?: I18nInstance;
  changeLanguage?: (lang: string) => void;
  initOptions?: I18nInitOptions;
  htmlLangAttr?: boolean;
  reactI18next?: boolean;
  [key: string]: any;
}

export const createI18nPlugin =
  (
    loadReactI18nextIntegration?: LoadReactI18nextIntegration,
  ): ((options: I18nPluginOptions) => RuntimePlugin) =>
  (options: I18nPluginOptions): RuntimePlugin => ({
    name: '@modern-js/plugin-i18n',
    setup: api => {
      const {
        entryName,
        i18nInstance: userI18nInstance,
        initOptions,
        localeDetection,
        backend,
        htmlLangAttr = false,
        reactI18next = true,
      } = options;
      const {
        localePathRedirect = false,
        i18nextDetector = true,
        languages = [],
        fallbackLanguage = 'en',
        detection,
        ignoreRedirectRoutes,
        localisedUrls,
      } = localeDetection || {};
      const { enabled: backendEnabled = false } = backend || {};
      let latestI18nInstance: I18nInstance | undefined;
      let I18nextProvider: React.ComponentType<any> | null;

      api.onBeforeRender(async (context: RuntimeContextWithI18n) => {
        latestI18nInstance = await setupI18nBeforeRender(context, {
          api,
          userI18nInstance,
          initOptions,
          backend,
          backendEnabled,
          i18nextDetector,
          detection,
          localePathRedirect,
          languages,
          fallbackLanguage,
          resolveReactI18nextIntegration: () =>
            resolveReactI18nextIntegration(
              reactI18next,
              loadReactI18nextIntegration,
            ),
          setI18nextProvider: provider => {
            I18nextProvider = provider;
          },
        });
      });

      api.wrapRoot(
        createI18nRootWrapper({
          entryName,
          htmlLangAttr,
          localePathRedirect,
          languages,
          fallbackLanguage,
          ignoreRedirectRoutes,
          localisedUrls,
          getLatestI18nInstance: () => latestI18nInstance,
          getI18nextProvider: () => I18nextProvider,
        }),
      );
    },
  });

export type {
  AllowedLinkTarget,
  CanonicalRoutePath,
  UltramodernCanonicalRoutes,
} from './canonicalRoutes';
export {
  FederatedI18nBoundary,
  type FederatedI18nBoundaryProps,
  type UseModernI18nReturn,
  useModernI18n,
} from './context';
export { I18nLink, type I18nLinkProps } from './I18nLink';
export {
  Link,
  type LinkActiveOptions,
  type LinkBaseProps,
  type LinkParams,
  type LinkProps,
} from './Link';
export {
  canonicalPath,
  type LocalizedPathsConfig,
  localizePath,
  type UseLocalizedLocationReturn,
  type UseLocalizedPathsReturn,
  useLocalizedLocation,
  useLocalizedPaths,
} from './localizedPaths';
export { buildLocalizedUrl, splitUrlTarget } from './utils';
