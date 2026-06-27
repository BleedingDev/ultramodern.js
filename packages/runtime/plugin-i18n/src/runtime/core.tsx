import {
  isBrowser,
  RuntimeContext,
  type RuntimePlugin,
} from '@modern-js/runtime';
import { Helmet } from '@modern-js/runtime/head';
import type { TInternalRuntimeContext } from '@modern-js/runtime/internal';
import { merge } from '@modern-js/runtime-utils/merge';
import type React from 'react';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BaseBackendOptions,
  BaseLocaleDetectionOptions,
} from '../shared/type';
import { ModernI18nProvider } from './context';
import {
  createContextValue,
  useClientSideRedirect,
  useLanguageSync,
  useSdkResourcesLoader,
} from './hooks';
import type { I18nInitOptions, I18nInstance } from './i18n';
import { getI18nInstance } from './i18n';
import { mergeBackendOptions } from './i18n/backend';
import {
  detectLanguageWithPriority,
  exportServerLngToWindow,
  mergeDetectionOptions,
} from './i18n/detection';
import { useI18nextLanguageDetector } from './i18n/detection/middleware';
import { getI18nextInstanceForProvider } from './i18n/instance';
import { getPathname } from './utils';
import './types';

export type { I18nSdkLoader, I18nSdkLoadOptions } from '../shared/type';
export type { Resources } from './i18n/instance';

type I18nLifecycleHelpers = {
  useI18nextBackend: typeof import('./i18n/backend/middleware')['useI18nextBackend'];
  changeI18nLanguage: typeof import('./i18n/utils')['changeI18nLanguage'];
  ensureLanguageMatch: typeof import('./i18n/utils')['ensureLanguageMatch'];
  initializeI18nInstance: typeof import('./i18n/utils')['initializeI18nInstance'];
  setupClonedInstance: typeof import('./i18n/utils')['setupClonedInstance'];
};

let i18nLifecycleHelpersPromise: Promise<I18nLifecycleHelpers> | undefined;

function loadI18nLifecycleHelpers(): Promise<I18nLifecycleHelpers> {
  i18nLifecycleHelpersPromise ??= Promise.all([
    import('./i18n/backend/middleware'),
    import('./i18n/utils'),
  ]).then(([backendMiddleware, utils]) => ({
    useI18nextBackend: backendMiddleware.useI18nextBackend,
    changeI18nLanguage: utils.changeI18nLanguage,
    ensureLanguageMatch: utils.ensureLanguageMatch,
    initializeI18nInstance: utils.initializeI18nInstance,
    setupClonedInstance: utils.setupClonedInstance,
  }));

  return i18nLifecycleHelpersPromise;
}

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

interface RuntimeContextWithI18n extends TInternalRuntimeContext {
  i18nInstance?: I18nInstance;
  changeLanguage?: (lang: string) => Promise<void>;
}

export interface ReactI18nextIntegration {
  I18nextProvider: React.ComponentType<any> | null;
  initReactI18next: any | null;
}

export type LoadReactI18nextIntegration =
  () => Promise<ReactI18nextIntegration | null>;

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

      const resolveReactI18nextIntegration = async () => {
        if (!reactI18next) {
          return null;
        }
        return loadReactI18nextIntegration?.() ?? null;
      };

      api.onBeforeRender(async context => {
        const {
          useI18nextBackend,
          changeI18nLanguage,
          ensureLanguageMatch,
          initializeI18nInstance,
          setupClonedInstance,
        } = await loadI18nLifecycleHelpers();
        let i18nInstance = await getI18nInstance(userI18nInstance);
        const { i18n: otherConfig } = api.getRuntimeConfig();
        const { initOptions: otherInitOptions } = otherConfig || {};
        const userInitOptions = merge(
          otherInitOptions || {},
          initOptions || {},
        );
        const reactI18nextIntegration = await resolveReactI18nextIntegration();
        I18nextProvider = reactI18nextIntegration?.I18nextProvider ?? null;
        if (reactI18nextIntegration?.initReactI18next) {
          i18nInstance.use(reactI18nextIntegration.initReactI18next);
        }

        const pathname = getPathname(context);

        if (i18nextDetector) {
          useI18nextLanguageDetector(i18nInstance);
        }

        const mergedDetection = mergeDetectionOptions(
          i18nextDetector,
          detection,
          localePathRedirect,
          userInitOptions,
        );
        const mergedBackend = mergeBackendOptions(backend, userInitOptions);

        // Register Backend BEFORE detectLanguageWithPriority
        // This is critical because detectLanguageWithPriority may trigger init()
        // through i18next detector, and backend must be registered before init()
        // Register backend if:
        // 1. enabled is true (explicitly or auto-detected), OR
        // 2. SDK is configured (allows standalone SDK usage even without locales directory)
        const hasSdkConfig =
          typeof userInitOptions?.backend?.sdk === 'function' ||
          (mergedBackend?.sdk && typeof mergedBackend.sdk === 'function');
        if (mergedBackend && (backendEnabled || hasSdkConfig)) {
          useI18nextBackend(i18nInstance, mergedBackend);
        }

        const { finalLanguage } = await detectLanguageWithPriority(
          i18nInstance,
          {
            languages,
            fallbackLanguage,
            localePathRedirect,
            i18nextDetector,
            detection,
            userInitOptions,
            mergedBackend,
            pathname,
            ssrContext: context.ssrContext,
          },
        );

        await initializeI18nInstance(
          i18nInstance,
          finalLanguage,
          fallbackLanguage,
          languages,
          mergedDetection,
          mergedBackend,
          userInitOptions,
        );

        if (!isBrowser() && i18nInstance.cloneInstance) {
          i18nInstance = i18nInstance.cloneInstance();
          await setupClonedInstance(
            i18nInstance,
            finalLanguage,
            fallbackLanguage,
            languages,
            backendEnabled,
            backend,
            i18nextDetector,
            detection,
            localePathRedirect,
            userInitOptions,
          );
        }

        if (localePathRedirect) {
          await ensureLanguageMatch(i18nInstance, finalLanguage);
        }

        if (!isBrowser()) {
          exportServerLngToWindow(context, finalLanguage);
        }
        context.i18nInstance = i18nInstance;
        latestI18nInstance = i18nInstance;

        // Add changeLanguage method to context for other runtime plugins to use
        context.changeLanguage = async (newLang: string) => {
          await changeI18nLanguage(i18nInstance, newLang, {
            detectionOptions: mergedDetection,
          });
        };
      });

      api.wrapRoot(App => {
        return props => {
          const runtimeContext = useContext(
            RuntimeContext,
          ) as RuntimeContextWithI18n;
          const i18nInstance =
            runtimeContext.i18nInstance || latestI18nInstance;
          const initialLang = useMemo(
            () =>
              i18nInstance?.language ||
              (localeDetection?.fallbackLanguage ?? 'en'),
            [i18nInstance?.language, localeDetection?.fallbackLanguage],
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
          // Handle client-side redirect for static deployments
          // Note: This hook only executes in browser environment and skips SSR scenarios
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
          const appContent = (
            <>
              {Boolean(htmlLangAttr) && <Helmet htmlAttributes={{ lang }} />}
              <ModernI18nProvider value={contextValue}>
                {App ? <App {...props}>{children}</App> : children}
              </ModernI18nProvider>
            </>
          );

          if (!i18nInstance) {
            return appContent;
          }

          if (I18nextProvider) {
            const i18nextInstanceForProvider =
              getI18nextInstanceForProvider(i18nInstance);
            return (
              <I18nextProvider i18n={i18nextInstanceForProvider}>
                {appContent}
              </I18nextProvider>
            );
          }

          return appContent;
        };
      });
    },
  });

export type {
  AllowedLinkTarget,
  CanonicalRoutePath,
  UltramodernCanonicalRoutes,
} from './canonicalRoutes';
export { useModernI18n } from './context';
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
