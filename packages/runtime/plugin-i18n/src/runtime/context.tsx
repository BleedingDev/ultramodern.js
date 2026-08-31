import type { LocalisedUrlsOption } from '@modern-js/i18n-runtime-extensions';
import type { ComponentType, FC, ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from 'react';
import {
  changeModernI18nLanguage,
  getPathLanguage,
  isI18nLanguageSupported,
  isI18nResourcesReady,
  translateI18n,
} from './contextHelpers';
import type { I18nInstance } from './i18n';
import type { Resources } from './i18n/instance';
import { getActualI18nextInstance } from './i18n/instance';
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
  synchronizeLanguage?: (newLang: string) => void;
}

const modernI18nContextKey = Symbol.for(
  '@modern-js/plugin-i18n/runtime/ModernI18nContext',
);
const reactI18nextProviderContextKey = Symbol.for(
  '@modern-js/plugin-i18n/runtime/ReactI18nextProviderContext',
);

type GlobalContextStore<T> = typeof globalThis & {
  [key: symbol]: ReturnType<typeof createContext<T>> | undefined;
};

const getGlobalContext = <T,>(key: symbol, defaultValue: T) => {
  const globalStore = globalThis as GlobalContextStore<T>;
  globalStore[key] ??= createContext<T>(defaultValue);
  return globalStore[key];
};

const ModernI18nContext = getGlobalContext<ModernI18nContextValue | null>(
  modernI18nContextKey,
  null,
);
const ReactI18nextProviderContext = getGlobalContext<ComponentType<any> | null>(
  reactI18nextProviderContextKey,
  null,
);

interface ModernI18nProviderProps {
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

/**
 * Keeps a federated surface's translation resources inside its delivery unit.
 * The host supplies only the active language; the remote owns and versions the
 * resources used below this boundary.
 */
export const FederatedI18nBoundary: FC<FederatedI18nBoundaryProps> = ({
  children,
  defaultNamespace,
  fallbackLanguage,
  resources,
  supportedLanguages,
}) => {
  const parent = useContext(ModernI18nContext);
  const I18nextProvider = useContext(ReactI18nextProviderContext);
  if (!parent) {
    throw new Error(
      'FederatedI18nBoundary must be used within ModernI18nProvider',
    );
  }

  const languages =
    supportedLanguages ?? parent.languages ?? Object.keys(resources);
  const scopedInstance = useMemo(() => {
    const parentInstance = getActualI18nextInstance(parent.i18nInstance);
    const clone = parentInstance.cloneInstance?.({
      defaultNS: defaultNamespace,
      fallbackLng: fallbackLanguage ?? languages[0] ?? parent.language,
      forkResourceStore: true,
      initImmediate: false,
      lng: parent.language,
      ns: [defaultNamespace],
      resources,
      supportedLngs: languages,
    });
    if (!clone) {
      throw new Error(
        'FederatedI18nBoundary requires an i18n instance with cloneInstance support',
      );
    }
    const resourceStore = clone.store;
    const parentResourceStore = parentInstance.store;
    const sharesNestedResourceState = Object.entries(
      resourceStore?.data ?? {},
    ).some(([language, namespaces]) => {
      const parentNamespaces = parentResourceStore?.data?.[language];
      return (
        namespaces === parentNamespaces ||
        Object.entries(namespaces).some(
          ([namespace, resource]) =>
            resource !== null &&
            typeof resource === 'object' &&
            resource === parentNamespaces?.[namespace],
        )
      );
    });
    if (
      clone === parentInstance ||
      resourceStore === parentResourceStore ||
      resourceStore?.data === parentResourceStore?.data ||
      sharesNestedResourceState
    ) {
      throw new Error(
        'FederatedI18nBoundary cloneInstance did not isolate the host resource store',
      );
    }
    if (
      !resourceStore?.addResourceBundle ||
      !clone.removeResourceBundle ||
      !resourceStore.data
    ) {
      throw new Error(
        'FederatedI18nBoundary requires an isolated mutable i18n resource store',
      );
    }
    for (const [language, namespaces] of Object.entries(resourceStore.data)) {
      for (const namespace of Object.keys(namespaces)) {
        clone.removeResourceBundle(language, namespace);
      }
    }
    for (const [language, namespaces] of Object.entries(resources)) {
      for (const [namespace, resource] of Object.entries(namespaces)) {
        resourceStore.addResourceBundle(
          language,
          namespace,
          resource as Record<string, string>,
          true,
          true,
        );
      }
    }
    return clone;
  }, [
    defaultNamespace,
    fallbackLanguage,
    languages,
    parent.i18nInstance,
    parent.language,
    resources,
  ]);
  const value = useMemo(
    () => ({
      ...parent,
      i18nInstance: scopedInstance,
      language: parent.language,
      languages,
    }),
    [languages, parent, scopedInstance],
  );

  const scopedContent = (
    <ModernI18nProvider value={value}>{children}</ModernI18nProvider>
  );
  return I18nextProvider ? (
    <I18nextProvider i18n={scopedInstance}>{scopedContent}</I18nextProvider>
  ) : (
    scopedContent
  );
};

export interface UseModernI18nReturn<
  TInstance extends I18nInstance = I18nInstance,
> {
  language: string;
  changeLanguage: (newLang: string) => Promise<void>;
  t: (key: string | string[], ...args: any[]) => string;
  i18nInstance: TInstance;
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
    localisedUrls,
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
    // The provider stores the instance as the base `I18nInstance`; the caller
    // narrows to the concrete instance type via the TInstance type argument.
    i18nInstance: i18nInstance as TInstance,
    supportedLanguages: languages || [],
    localisedUrls,
    isLanguageSupported,
    isResourcesReady,
  };
};
