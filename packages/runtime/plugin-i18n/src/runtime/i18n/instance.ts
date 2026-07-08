import type { BaseBackendOptions } from '../../shared/type';

export interface I18nResourceStore {
  data?: {
    [language: string]: {
      [namespace: string]: ResourceValue;
    };
  };
  addResourceBundle?: (
    language: string,
    namespace: string,
    resources: Record<string, string>,
    deep?: boolean,
    overwrite?: boolean,
  ) => void;
}

type I18nWrapperInstance = I18nInstance & {
  i18nInstance: {
    instance: I18nInstance;
  };
};

export function isI18nWrapperInstance(
  obj: unknown,
): obj is I18nWrapperInstance {
  if (!obj || typeof obj !== 'object') {
    return false;
  }
  const candidate = obj as {
    i18nInstance?: unknown;
    init?: unknown;
    use?: unknown;
  };
  if (!candidate.i18nInstance || typeof candidate.i18nInstance !== 'object') {
    return false;
  }
  const wrapper = candidate.i18nInstance as { instance?: unknown };
  if (!wrapper.instance) {
    return false;
  }
  if (
    typeof candidate.init !== 'function' ||
    typeof candidate.use !== 'function'
  ) {
    return false;
  }
  return true;
}

export function getI18nWrapperI18nextInstance(
  wrapperInstance: unknown,
): I18nInstance | null {
  if (isI18nWrapperInstance(wrapperInstance)) {
    return wrapperInstance.i18nInstance?.instance;
  }
  return null;
}

export function getActualI18nextInstance(instance: I18nInstance): I18nInstance {
  if (isI18nWrapperInstance(instance)) {
    const i18nextInstance = getI18nWrapperI18nextInstance(instance);
    return i18nextInstance || instance;
  }
  return instance;
}

export interface I18nInstance {
  language: string;
  isInitialized?: boolean;
  init: {
    (callback?: (error: unknown, t: unknown) => void): Promise<unknown>;
    (
      options: I18nInitOptions,
      callback?: (error: unknown, t: unknown) => void,
    ): Promise<unknown>;
  };
  changeLanguage?: (
    lng?: string,
    callback?: (error: unknown, t: unknown) => void,
  ) => Promise<unknown>;
  setLang?: (lang: string) => void | Promise<void>;
  use: (plugin: unknown) => void;
  createInstance?: (options?: I18nInitOptions) => I18nInstance;
  cloneInstance?: () => I18nInstance; // ssr need
  // i18next store (may not be in type definition but exists at runtime)
  store?: I18nResourceStore;
  emit?: (event: string, ...args: unknown[]) => void;
  reloadResources?: (language?: string, namespace?: string) => Promise<void>;
  services?: {
    languageDetector?: {
      detect: (
        request?: unknown,
        options?: unknown,
      ) => string | string[] | undefined;
      [key: string]: unknown;
    };
    resourceStore?: I18nResourceStore;
    backend?: unknown; // Backend instance (e.g., SdkBackend)
    [key: string]: unknown;
  };
  // i18next instance options (available after initialization)
  options?: {
    backend?: BackendOptions;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

type LanguageDetectorOrder = string[];
type LanguageDetectorCaches = boolean | string[];
export interface LanguageDetectorOptions {
  order?: LanguageDetectorOrder;
  lookupQuerystring?: string;
  lookupCookie?: string;
  lookupLocalStorage?: string;
  lookupSession?: string;
  lookupFromPathIndex?: number;
  caches?: LanguageDetectorCaches;
  cookieExpirationDate?: Date;
  cookieDomain?: string;
  lookupHeader?: string;
}

export interface BackendOptions extends Omit<BaseBackendOptions, 'enabled'> {
  parse?: (data: string) => unknown;
  stringify?: (data: unknown) => string;
  [key: string]: any;
}

export type ResourceValue = string | { [key: string]: ResourceValue };

export interface Resources {
  [lng: string]: {
    [source: string]: ResourceValue;
  };
}

export type I18nInitOptions = {
  lng?: string;
  fallbackLng?: string;
  supportedLngs?: string[];
  initImmediate?: boolean;
  detection?: LanguageDetectorOptions;
  backend?: BackendOptions;
  resources?: Resources;
  ns?: string | string[];
  defaultNS?: string | string[];
  interpolation?: {
    escapeValue?: boolean;
    [key: string]: unknown;
  };
  react?: {
    useSuspense?: boolean;
    [key: string]: unknown;
  };
};

export function isI18nInstance(obj: unknown): obj is I18nInstance {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  if (isI18nWrapperInstance(obj)) {
    return true;
  }

  const candidate = obj as { init?: unknown; use?: unknown };
  return (
    typeof candidate.init === 'function' && typeof candidate.use === 'function'
  );
}

async function tryImportI18next(): Promise<I18nInstance | null> {
  try {
    const i18next = await import('i18next');
    return i18next.default as unknown as I18nInstance;
  } catch (error) {
    return null;
  }
}

async function createI18nextInstance(): Promise<I18nInstance | null> {
  try {
    const i18next = await tryImportI18next();
    if (!i18next) {
      return null;
    }
    return i18next.createInstance?.({
      initImmediate: false,
    }) as unknown as I18nInstance;
  } catch (error) {
    return null;
  }
}

export function getI18nextInstanceForProvider(
  instance: I18nInstance,
): I18nInstance {
  if (isI18nWrapperInstance(instance)) {
    const i18nextInstance = getI18nWrapperI18nextInstance(instance);
    if (i18nextInstance) {
      return i18nextInstance;
    }
  }

  return instance;
}

export async function getI18nInstance(
  userInstance?: unknown,
): Promise<I18nInstance> {
  if (userInstance) {
    if (isI18nWrapperInstance(userInstance)) {
      return userInstance as I18nInstance;
    }

    if (isI18nInstance(userInstance)) {
      return userInstance;
    }
  }

  const i18nextInstance = await createI18nextInstance();
  if (i18nextInstance) {
    return i18nextInstance;
  }

  throw new Error('No i18n instance found');
}
