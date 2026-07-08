import { RuntimeContext } from '@modern-js/runtime';
import { Helmet } from '@modern-js/runtime/head';
import type React from 'react';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { BaseLocaleDetectionOptions } from '../shared/type';
import { ModernI18nProvider } from './context';
import {
  createContextValue,
  useClientSideRedirect,
  useLanguageSync,
  useSdkResourcesLoader,
} from './hooks';
import type { I18nInstance } from './i18n';
import { getI18nextInstanceForProvider } from './i18n/instance';
import type { RuntimeContextWithI18n } from './pluginSetup';

interface I18nRootWrapperOptions {
  entryName?: string;
  htmlLangAttr: boolean;
  localePathRedirect: boolean;
  languages: string[];
  fallbackLanguage: string;
  ignoreRedirectRoutes?: BaseLocaleDetectionOptions['ignoreRedirectRoutes'];
  localisedUrls?: BaseLocaleDetectionOptions['localisedUrls'];
  getLatestI18nInstance: () => I18nInstance | undefined;
  getI18nextProvider: () => React.ComponentType<any> | null | undefined;
}

export const createI18nRootWrapper =
  (options: I18nRootWrapperOptions) => (App: React.ComponentType<any>) => {
    return (props: Record<string, unknown>) => {
      const {
        entryName,
        htmlLangAttr,
        localePathRedirect,
        languages,
        fallbackLanguage,
        ignoreRedirectRoutes,
        localisedUrls,
        getLatestI18nInstance,
        getI18nextProvider,
      } = options;
      const runtimeContext = useContext(
        RuntimeContext,
      ) as RuntimeContextWithI18n;
      const i18nInstance =
        runtimeContext.i18nInstance || getLatestI18nInstance();
      const initialLang = useMemo(
        () => i18nInstance?.language || fallbackLanguage,
        [i18nInstance?.language, fallbackLanguage],
      );
      const [lang, setLang] = useState(initialLang);
      const [forceUpdate, setForceUpdate] = useState(0);
      const prevLangRef = useRef(lang);
      const runtimeContextRef = useRef(runtimeContext);
      runtimeContextRef.current = runtimeContext;

      useEffect(() => {
        if (i18nInstance?.language) {
          const translator = (i18nInstance as any).translator;
          if (translator) {
            translator.language = i18nInstance.language;
          }
        }
      }, [i18nInstance?.language]);

      useEffect(() => {
        prevLangRef.current = lang;
      }, [lang]);

      useSdkResourcesLoader(i18nInstance, setForceUpdate);
      useLanguageSync(
        i18nInstance,
        localePathRedirect,
        languages,
        runtimeContextRef,
        prevLangRef,
        setLang,
      );

      // Handle client-side redirect for static deployments.
      useClientSideRedirect(
        i18nInstance,
        localePathRedirect,
        languages,
        fallbackLanguage,
        ignoreRedirectRoutes,
        localisedUrls,
      );

      const contextValue = useMemo(
        () =>
          createContextValue(
            lang,
            i18nInstance,
            entryName,
            languages,
            localePathRedirect,
            ignoreRedirectRoutes,
            localisedUrls,
            setLang,
          ),
        [
          lang,
          i18nInstance,
          entryName,
          languages,
          localePathRedirect,
          ignoreRedirectRoutes,
          localisedUrls,
          forceUpdate,
        ],
      );

      const children = (props as React.PropsWithChildren).children;
      let appContent: React.ReactNode = App ? (
        <App {...props}>{children}</App>
      ) : (
        children
      );

      if (i18nInstance) {
        const I18nextProvider = getI18nextProvider();
        if (I18nextProvider) {
          const i18nextInstanceForProvider =
            getI18nextInstanceForProvider(i18nInstance);
          appContent = (
            <I18nextProvider i18n={i18nextInstanceForProvider}>
              {appContent}
            </I18nextProvider>
          );
        }
      }

      return (
        <>
          {Boolean(htmlLangAttr) && <Helmet htmlAttributes={{ lang }} />}
          <ModernI18nProvider value={contextValue}>
            {appContent}
          </ModernI18nProvider>
        </>
      );
    };
  };
