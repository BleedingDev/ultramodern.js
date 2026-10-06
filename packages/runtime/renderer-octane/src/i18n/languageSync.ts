import {
  createLatestLanguageSyncBinding,
  type LanguageSyncFailure,
  type LanguageSyncPolicy,
} from '@modern-js/i18n-runtime-extensions/language-sync/controller';
import { useCallback, useEffect, useRef } from 'octane';

export interface OctaneLatestLanguageSyncOptions<TTarget extends object> {
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

/**
 * Octane binding over the fork's renderer-neutral `Coordinator`/`Binding`
 * pair (`@modern-js/i18n-runtime-extensions`'s `createLatestLanguageSyncBinding`):
 * the same "latest intent wins, retry with backoff, report terminal failure"
 * policy the React `useLatestLanguageSync` hook drives.
 *
 * Octane's own hook API (`useState`/`useEffect`/`useContext`/
 * `useSyncExternalStore`, confirmed in `node_modules/octane/dist/runtime.d.ts`)
 * is React-shaped, so this binding mirrors
 * `i18n-extensions/src/language-sync/react.ts`'s `useLatestLanguageSync`
 * directly — the Solid binding needed a `createEffect`/`onCleanup`
 * reshaping for Solid 2's different (compute/effect-split, no
 * `useEffect`-style dependency arrays) reactivity model; Octane does not.
 */
export const useLatestLanguageSync = <TTarget extends object>({
  changeLanguage,
  commitLanguage,
  desiredLanguage,
  enabled = true,
  policy,
  readLanguage,
  reportFailure,
  target,
}: OctaneLatestLanguageSyncOptions<TTarget>): ((language: string) => void) => {
  const bindingRef = useRef<ReturnType<
    typeof createLatestLanguageSyncBinding<TTarget>
  > | null>(null);
  if (bindingRef.current === null) {
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
