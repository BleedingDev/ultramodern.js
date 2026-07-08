import type { FC, ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from 'react';
import type { LocalisedUrlsOption } from '../shared/localisedUrls';
import {
  cacheI18nLanguage,
  changeModernI18nLanguage,
  getPathLanguage,
  isI18nLanguageSupported,
  isI18nResourcesReady,
  translateI18n,
} from './contextHelpers';
import type { I18nInstance } from './i18n';
import { useI18nRouterAdapter } from './routerAdapter';

interface ModernI18nContextValue {
  language: string;
  i18nInstance: I18nInstance;
  // Plugin configuration for useModernI18n hook
  entryName?: string;
  languages?: string[];
  localePathRedirect?: boolean;
  ignoreRedirectRoutes?: string[] | ((pathname: string) => boolean);
  localisedUrls?: LocalisedUrlsOption;
  // Callback to update language in context
  updateLanguage?: (newLang: string) => void;
}

const modernI18nContextKey = Symbol.for(
  '@modern-js/plugin-i18n/runtime/ModernI18nContext',
);

type ModernI18nGlobal = typeof globalThis & {
  [key: symbol]:
    | ReturnType<typeof createContext<ModernI18nContextValue | null>>
    | undefined;
};

const getModernI18nContext = () => {
  const globalStore = globalThis as ModernI18nGlobal;
  globalStore[modernI18nContextKey] ??=
    createContext<ModernI18nContextValue | null>(null);
  return globalStore[modernI18nContextKey];
};

const ModernI18nContext = getModernI18nContext();

interface ModernI18nProviderProps {
  children: ReactNode;
  value: ModernI18nContextValue;
}

export const ModernI18nProvider: FC<ModernI18nProviderProps> = ({
  children,
  value,
}) => {
  return (
    <ModernI18nContext.Provider value={value}>
      {children}
    </ModernI18nContext.Provider>
  );
};

interface UseModernI18nReturn {
  language: string;
  changeLanguage: (newLang: string) => Promise<void>;
  t: (key: string | string[], ...args: any[]) => string;
  i18nInstance: I18nInstance;
  supportedLanguages: string[];
  localisedUrls?: LocalisedUrlsOption;
  isLanguageSupported: (lang: string) => boolean;
  // Indicates whether translation resources for current language are ready
  isResourcesReady: boolean;
}

/**
 * Hook for accessing i18n functionality in Modern.js applications.
 *
 * This hook provides:
 * - Current language from URL params or i18n context
 * - changeLanguage function that updates both i18n instance and URL
 * - Direct access to i18n instance
 * - List of supported languages
 * - Helper function to check if language is supported
 *
 * @param options - Optional configuration to override context settings
 * @returns Object containing i18n functionality and utilities
 */
export const useModernI18n = (): UseModernI18nReturn => {
  const context = useContext(ModernI18nContext);
  if (!context) {
    throw new Error('useModernI18n must be used within ModernI18nProvider');
  }

  const {
    language: contextLanguage,
    i18nInstance,
    languages,
    localePathRedirect,
    ignoreRedirectRoutes,
    localisedUrls,
    updateLanguage,
  } = context;

  const { navigate, location, hasRouter } = useI18nRouterAdapter();

  const pathLanguage = useMemo(
    () => getPathLanguage(location?.pathname, languages, localePathRedirect),
    [languages, localePathRedirect, location?.pathname],
  );

  const currentLanguage = pathLanguage || contextLanguage;

  useEffect(() => {
    if (!pathLanguage || pathLanguage === contextLanguage) {
      return;
    }

    updateLanguage?.(pathLanguage);
    i18nInstance?.setLang?.(pathLanguage);
    void i18nInstance?.changeLanguage?.(pathLanguage);
    cacheI18nLanguage(i18nInstance, pathLanguage);
  }, [contextLanguage, i18nInstance, pathLanguage, updateLanguage]);

  /**
   * Changes the current language and updates URL accordingly.
   *
   * This function:
   * 1. Updates i18n instance language
   * 2. Updates URL by replacing language prefix in the current path
   * 3. Triggers navigation to the new URL
   *
   * @param newLang - The new language code to switch to
   */
  const changeLanguage = useCallback(
    (newLang: string) =>
      changeModernI18nLanguage(newLang, {
        i18nInstance,
        updateLanguage,
        localePathRedirect,
        ignoreRedirectRoutes,
        localisedUrls,
        languages,
        hasRouter,
        navigate,
        location,
      }),
    [
      i18nInstance,
      updateLanguage,
      localePathRedirect,
      ignoreRedirectRoutes,
      localisedUrls,
      languages,
      hasRouter,
      navigate,
      location,
    ],
  );

  const t = useCallback(
    (key: string | string[], ...args: any[]) =>
      translateI18n(i18nInstance, key, ...args),
    [currentLanguage, i18nInstance],
  );

  // Helper function to check if language is supported
  const isLanguageSupported = useCallback(
    (lang: string) => isI18nLanguageSupported(languages, lang),
    [languages],
  );

  // Check if current language resources are ready
  // This checks if all required namespaces for current language are loaded
  const isResourcesReady = useMemo(
    () => isI18nResourcesReady(i18nInstance, currentLanguage),
    [currentLanguage, i18nInstance],
  );

  return {
    language: currentLanguage,
    changeLanguage,
    t,
    i18nInstance,
    supportedLanguages: languages || [],
    localisedUrls,
    isLanguageSupported,
    isResourcesReady,
  };
};
