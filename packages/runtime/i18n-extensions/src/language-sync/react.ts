import { getGlobalBasename } from '@modern-js/runtime/context';
import LanguageDetector, {
  type DetectorOptions,
} from 'i18next-browser-languagedetector';
import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import {
  createLatestLanguageSyncBinding,
  type LanguageSyncFailure,
  type LanguageSyncPolicy,
} from './controller';

export interface LatestLanguageSyncOptions<TTarget extends object> {
  changeLanguage: (
    target: TTarget,
    language: string,
  ) => PromiseLike<unknown> | unknown;
  commitLanguage: (target: TTarget, language: string) => void;
  desiredLanguage?: string;
  enabled?: boolean;
  policy?: LanguageSyncPolicy;
  readLanguage?: (target: TTarget) => string | undefined;
  reportFailure?: (failure: LanguageSyncFailure) => void;
  target?: TTarget;
}

export const useLatestLanguageSync = <TTarget extends object>({
  changeLanguage,
  commitLanguage,
  desiredLanguage,
  enabled = true,
  policy,
  readLanguage,
  reportFailure,
  target,
}: LatestLanguageSyncOptions<TTarget>) => {
  const bindingRef = useRef<ReturnType<
    typeof createLatestLanguageSyncBinding<TTarget>
  > | null>(null);
  if (bindingRef.current === null) {
    // Binding construction is deliberately inert. Shared coordinator state is
    // touched only by the commit-phase activation effect below.
    bindingRef.current = createLatestLanguageSyncBinding<TTarget>(policy);
  }
  const binding = bindingRef.current;

  useEffect(() => {
    binding.updateCallbacks({
      changeLanguage,
      commitLanguage,
      readLanguage,
      reportFailure,
    });
  });

  useEffect(() => {
    if (!enabled || !target) {
      return;
    }
    binding.activate(target);
    return () => binding.deactivate();
  }, [binding, enabled, target]);

  useEffect(() => {
    if (!enabled || !target || !desiredLanguage) {
      binding.clearRequest();
      return;
    }
    binding.request(desiredLanguage);
  }, [binding, desiredLanguage, enabled, target]);

  useEffect(() => {
    if (
      !enabled ||
      !target ||
      !desiredLanguage ||
      typeof window === 'undefined'
    ) {
      return;
    }
    const retryCurrentIntent = () => binding.request(desiredLanguage);
    const retryVisibleIntent = () => {
      if (document.visibilityState === 'visible') {
        retryCurrentIntent();
      }
    };
    window.addEventListener('online', retryCurrentIntent);
    document.addEventListener('visibilitychange', retryVisibleIntent);
    return () => {
      window.removeEventListener('online', retryCurrentIntent);
      document.removeEventListener('visibilitychange', retryVisibleIntent);
    };
  }, [binding, desiredLanguage, enabled, target]);

  return useCallback(
    (language: string) => binding.request(language),
    [binding],
  );
};

interface LanguageDetectorLike {
  cacheUserLanguage?: (language: string) => void;
}

export interface I18nLanguageSyncInstance {
  changeLanguage?: (language?: string) => PromiseLike<unknown> | unknown;
  i18nInstance?: { instance?: I18nLanguageSyncInstance };
  isInitialized?: boolean;
  language: string;
  options?: { detection?: unknown };
  services?: {
    languageDetector?: LanguageDetectorLike;
  };
  setLang?: (language: string) => PromiseLike<unknown> | unknown;
}

const actualInstance = (instance: I18nLanguageSyncInstance) =>
  instance.i18nInstance?.instance ?? instance;

const cacheLanguage = (
  instance: I18nLanguageSyncInstance,
  language: string,
) => {
  if (typeof window === 'undefined') {
    return;
  }
  const actual = actualInstance(instance);
  const detector =
    actual.services?.languageDetector ?? instance.services?.languageDetector;
  try {
    if (detector?.cacheUserLanguage) {
      detector.cacheUserLanguage(language);
      return;
    }
    if (instance.isInitialized || actual.isInitialized) {
      const services = actual.services ?? instance.services;
      const options = actual.options ?? instance.options;
      if (services && options) {
        const manualDetector = new LanguageDetector();
        manualDetector.init(
          services,
          (instance.options?.detection ?? options.detection) as
            | DetectorOptions
            | undefined,
        );
        manualDetector.cacheUserLanguage?.(language);
      }
    }
  } catch {
    // Caching is a best-effort side effect; synchronization already committed.
  }
};

const detectPathLanguage = (
  pathname: string | undefined,
  languages: string[],
) => {
  if (!pathname) {
    return undefined;
  }
  const basename = getGlobalBasename();
  const entryPath = basename && basename !== '/' ? basename : '';
  const relativePath = pathname.startsWith(entryPath)
    ? pathname.slice(entryPath.length)
    : pathname;
  const segments = relativePath.split('/').filter(Boolean);
  const segmentsToCheck =
    !entryPath &&
    segments.length > 1 &&
    segments[0] &&
    !languages.includes(segments[0])
      ? segments.slice(1)
      : segments;
  const language = segmentsToCheck[0];
  return language && languages.includes(language) ? language : undefined;
};

/**
 * Compatibility-shaped adapter for the Modern.js i18n provider. The shared
 * coordinator is fork-owned; the upstream hook remains available to direct
 * internal consumers until the equivalent shrink can be upstreamed.
 */
export function useLanguageSync<TInstance extends I18nLanguageSyncInstance>(
  i18nInstance: TInstance | undefined,
  localePathRedirect: boolean,
  languages: string[],
  pathname: string | undefined,
  prevLangRef: React.MutableRefObject<string>,
  setLang: (language: string) => void,
) {
  const desiredLanguage = localePathRedirect
    ? detectPathLanguage(pathname, languages)
    : undefined;
  const synchronizeLanguage = useLatestLanguageSync({
    target: i18nInstance,
    desiredLanguage,
    enabled: Boolean(i18nInstance && localePathRedirect),
    readLanguage: instance => instance.language,
    changeLanguage: (instance, language) =>
      instance.setLang
        ? instance.setLang(language)
        : instance.changeLanguage?.(language),
    commitLanguage: (instance, language) => {
      prevLangRef.current = language;
      setLang(language);
      cacheLanguage(instance, language);
    },
    reportFailure: ({ error, language }) => {
      console.error(
        `Failed to synchronize i18n language "${language}".`,
        error,
      );
    },
  });

  useEffect(() => {
    if (!localePathRedirect && i18nInstance?.language) {
      const instanceLanguage = i18nInstance.language;
      if (instanceLanguage !== prevLangRef.current) {
        prevLangRef.current = instanceLanguage;
        setLang(instanceLanguage);
      }
    }
  }, [i18nInstance, localePathRedirect, prevLangRef, setLang]);

  return synchronizeLanguage;
}
