import type { BaseBackendOptions } from '../../shared/type';

interface I18nResourceStore {
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

function getI18nWrapperI18nextInstance(
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

export type TranslateFn = (
  key: string | string[],
  options?: Record<string, unknown>,
) => string;

// FORK: intentionally diverges from upstream @modern-js/plugin-i18n. Upstream
// declares a top-level `[key: string]: any` and overloaded call-signature
// properties; both make i18next's `i18n` structurally unassignable to this
// type, so the documented `i18nInstance: i18next` usage does not typecheck.
// Do NOT restore upstream's shape when resolving a sync merge — the guard is
// tests/type-fixture/i18nInstanceTypes.fixture.ts.
export interface I18nInstance {
  language: string;
  isInitialized?: boolean;
  // Single non-overloaded method signatures. Method syntax is required for
  // bivariant parameter checking; a SINGLE signature is required because
  // overload bivariance is order-dependent across program compositions.
  init(options?: any, callback?: any): Promise<any>;
  changeLanguage?(lng?: string, callback?: any): Promise<any>;
  setLang?: (lang: string) => void | Promise<void>;
  use(plugin: any): unknown;
  t: TranslateFn;
  exists?: (
    key: string | string[],
    options?: Record<string, unknown>,
  ) => boolean;
  // `lng` is required: i18next's getFixedT does not accept `undefined`.
  getFixedT?: (
    lng: string | readonly string[] | null,
    ns?: string | readonly string[] | null,
    keyPrefix?: string,
  ) => TranslateFn;
  hasLoadedNamespace?: (
    ns: string | readonly string[],
    options?: Record<string, unknown>,
  ) => boolean;
  dir?: (lng?: string) => string;
  format?: (
    value: unknown,
    format?: string,
    lng?: string,
    options?: Record<string, unknown>,
  ) => string;
  // readonly: i18next declares `languages: readonly string[]`.
  languages?: readonly string[];
  resolvedLanguage?: string;
  loadNamespaces?: (
    ns: string | readonly string[],
    callback?: (...args: any[]) => void,
  ) => Promise<void>;
  loadLanguages?: (
    lngs: string | readonly string[],
    callback?: (...args: any[]) => void,
  ) => Promise<void>;
  addResourceBundle?: (
    lng: string,
    ns: string,
    resources: Record<string, unknown>,
    deep?: boolean,
    overwrite?: boolean,
  ) => unknown;
  getResourceBundle?: (lng: string, ns: string) => unknown;
  getDataByLanguage?: (
    lng: string,
  ) => Record<string, Record<string, string>> | undefined;
  createInstance?(options?: any, callback?: any): I18nInstance;
  cloneInstance?(options?: any, callback?: any): I18nInstance; // ssr need
  // i18next store (may not be in the type definition but exists at runtime)
  store?: I18nResourceStore;
  emit?(event: string, ...args: any[]): unknown;
  reloadResources?(
    language?: any,
    namespace?: any,
    callback?: any,
  ): Promise<void>;
  removeResourceBundle?(language: string, namespace: string): I18nInstance;
  // No nested index signature: i18next's `Services` is an interface and would
  // fail "Index signature for type 'string' is missing".
  services?: {
    store?: unknown;
    languageDetector?: any;
    resourceStore?: I18nResourceStore;
    backend?: unknown; // Backend instance (e.g. SdkBackend)
  };
  // i18next instance options (available after initialization)
  options?: {
    detection?: any;
    backend?: any;
    ns?: any;
    defaultNS?: any;
  };
  // NO `[key: string]: unknown`. TypeScript never grants an interface an
  // implicit index signature, so any index signature here makes i18next's
  // `i18n` permanently unassignable. BREAKING for consumers that read
  // undeclared properties off I18nInstance.
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

type ResourceValue = string | { [key: string]: ResourceValue };

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
  forkResourceStore?: boolean;
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
  language?: string,
): I18nInstance {
  let providerInstance = instance;
  if (isI18nWrapperInstance(instance)) {
    const i18nextInstance = getI18nWrapperI18nextInstance(instance);
    if (i18nextInstance) {
      providerInstance = i18nextInstance;
    }
  }

  if (!language || typeof Proxy === 'undefined') {
    return providerInstance;
  }

  return new Proxy(providerInstance, {
    get(target, property, receiver) {
      if (property === 'language' || property === 'resolvedLanguage') {
        return language;
      }
      if (property === 'languages') {
        const languages = Reflect.get(target, property, receiver);
        return Array.isArray(languages)
          ? [language, ...languages.filter(item => item !== language)]
          : [language];
      }
      if (property === 't' && typeof target.getFixedT === 'function') {
        return target.getFixedT(language);
      }
      if (
        property === 'hasLoadedNamespace' &&
        typeof target.hasLoadedNamespace === 'function'
      ) {
        const hasLoadedNamespace = target.hasLoadedNamespace as (
          this: I18nInstance,
          namespace: string,
          options?: Record<string, unknown>,
        ) => boolean;
        return (namespace: string, options?: Record<string, unknown>) =>
          hasLoadedNamespace.call(target, namespace, {
            ...options,
            lng: options?.lng || language,
          });
      }
      return Reflect.get(target, property, receiver);
    },
  });
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
