import { RuntimeComponentResolverContext } from '@modern-js/runtime/context';
import type { ComponentType, FC, ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo } from 'react';
import type { I18nUrlStrategy } from '../shared/urlStrategy';
import {
  changeModernI18nLanguage,
  getPathLanguage,
  isI18nLanguageSupported,
  isI18nResourcesReady,
  translateI18n,
} from './contextHelpers';
import type { I18nInstance } from './i18n';
import type { Resources } from './i18n/instance';

import { useI18nRouterAdapter } from './routerAdapter';
import {
  ModernI18nContext,
  ReactI18nextProviderContext,
} from './sharedContexts';

export { getActualI18nextInstance } from './i18n/instance';

export interface ModernI18nContextValue {
  language: string;
  i18nInstance: I18nInstance;
  // Plugin configuration for useModernI18n hook
  entryName?: string;
  languages?: string[];
  localePathRedirect?: boolean;
  ignoreRedirectRoutes?: string[] | ((pathname: string) => boolean);
  urlStrategy?: I18nUrlStrategy;
  // Callback to update language in context
  updateLanguage?: (newLang: string) => void;
  synchronizeLanguage?: (newLang: string) => void;
}

export { ModernI18nContext, ReactI18nextProviderContext };

export interface ModernI18nProviderProps {
  children: ReactNode;
  i18nextProvider?: ComponentType<any> | null;
  value: ModernI18nContextValue;
}

export const ModernI18nProvider: FC<ModernI18nProviderProps> = ({
  children,
  i18nextProvider,
  value,
}) => {
  const content = (
    <ModernI18nContext.Provider value={value}>
      {children}
    </ModernI18nContext.Provider>
  );
  return i18nextProvider === undefined ? (
    content
  ) : (
    <ReactI18nextProviderContext.Provider value={i18nextProvider}>
      {content}
    </ReactI18nextProviderContext.Provider>
  );
};

export interface FederatedI18nBoundaryProps {
  children: ReactNode;
  defaultNamespace: string;
  fallbackLanguage?: string;
  resources: Resources;
  supportedLanguages?: string[];
}

const MissingFederatedI18nBoundary: FC<FederatedI18nBoundaryProps> = () => {
  throw new Error(
    'FederatedI18nBoundary requires the @modern-js/i18n-integration runtime plugin',
  );
};

export const FederatedI18nBoundary: FC<FederatedI18nBoundaryProps> = props => {
  const resolveComponent = useContext(RuntimeComponentResolverContext);
  const Boundary =
    resolveComponent?.(MissingFederatedI18nBoundary, {
      name: 'i18n.FederatedI18nBoundary',
    }) ?? MissingFederatedI18nBoundary;
  if (Boundary === FederatedI18nBoundary) {
    throw new Error('FederatedI18nBoundary resolver returned its own wrapper');
  }
  return <Boundary {...props} />;
};

export interface UseModernI18nReturn<
  TInstance extends I18nInstance = I18nInstance,
> {
  language: string;
  changeLanguage: (newLang: string) => Promise<void>;
  t: (key: string | string[], ...args: any[]) => string;
  i18nInstance: TInstance;
  supportedLanguages: string[];
  urlStrategy?: I18nUrlStrategy;
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
 * @typeParam TInstance - The concrete shape of the i18n instance held by the
 * provider (e.g. i18next's `i18n`, or a wrapper type). Constrained to
 * `I18nInstance`, so a nonsense argument is rejected; within that constraint it
 * is still a caller assertion — the provider stores the base type and the
 * narrowing is not verified at runtime. Pass it only when you know which
 * instance the provider was given.
 * @param options - Optional configuration to override context settings
 * @returns Object containing i18n functionality and utilities
 */
export const useModernI18n = <
  TInstance extends I18nInstance = I18nInstance,
>(): UseModernI18nReturn<TInstance> => {
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
    urlStrategy,
    updateLanguage,
    synchronizeLanguage,
  } = context;

  const { navigate, location, hasRouter } = useI18nRouterAdapter();

  const pathLanguage = useMemo(
    () => getPathLanguage(location?.pathname, languages, localePathRedirect),
    [languages, localePathRedirect, location?.pathname],
  );

  useEffect(() => {
    if (pathLanguage) {
      synchronizeLanguage?.(pathLanguage);
    }
  }, [pathLanguage, synchronizeLanguage]);

  const currentLanguage = contextLanguage;

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
        urlStrategy,
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
      urlStrategy,
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
    // The provider stores the instance as the base `I18nInstance`; the caller
    // narrows to the concrete instance type via the TInstance type argument.
    i18nInstance: i18nInstance as TInstance,
    supportedLanguages: languages || [],
    urlStrategy,
    isLanguageSupported,
    isResourcesReady,
  };
};
