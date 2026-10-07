import {
  createLatestLanguageSyncBinding,
  type LanguageSyncFailure,
  type LanguageSyncPolicy,
} from '@modern-js/i18n-runtime-extensions/language-sync/controller';
import * as Solid from 'solid-js';

export interface SolidLatestLanguageSyncOptions<TTarget extends object> {
  /** The sync target, e.g. the per-request i18next instance. Reactive. */
  target: Solid.Accessor<TTarget | undefined>;
  /** The language the URL (or other source of truth) currently wants. Reactive. */
  desiredLanguage: Solid.Accessor<string | undefined>;
  changeLanguage: (
    target: TTarget,
    language: string,
  ) => PromiseLike<unknown> | unknown;
  commitLanguage: (target: TTarget, language: string) => void;
  /** @default () => true */
  enabled?: Solid.Accessor<boolean>;
  policy?: LanguageSyncPolicy;
  readLanguage?: (target: TTarget) => string | undefined;
  reportFailure?: (failure: LanguageSyncFailure) => void;
}

/**
 * Solid binding over the fork's renderer-neutral `Coordinator`/`Binding` pair
 * (`@modern-js/i18n-runtime-extensions`'s `createLatestLanguageSyncBinding`):
 * the same "latest intent wins, retry with backoff, report terminal failure"
 * policy the React `useLatestLanguageSync` hook drives.
 *
 * Solid 2's `createEffect` has a compute/effect split (`compute(prev)` is
 * tracked, `effect(next)` runs imperatively and may return a cleanup run
 * before the next invocation or on disposal) rather than Solid 1's
 * single-phase `createEffect(fn)` — reactive reads happen in `compute`,
 * subscriptions happen in `effect`, which returns their cleanup.
 *
 * Returns a function to request a language change (e.g. from a language
 * switcher), independent of the reactive `desiredLanguage` source.
 */
export function createLatestLanguageSync<TTarget extends object>(
  options: SolidLatestLanguageSyncOptions<TTarget>,
): (language: string) => void {
  const binding = createLatestLanguageSyncBinding<TTarget>(options.policy);
  const enabled = () => options.enabled?.() ?? true;

  Solid.createEffect(
    () => undefined,
    () => {
      binding.updateCallbacks({
        changeLanguage: options.changeLanguage,
        commitLanguage: options.commitLanguage,
        readLanguage: options.readLanguage,
        reportFailure: options.reportFailure,
      });
    },
  );

  Solid.createEffect(
    () => (enabled() ? options.target() : undefined),
    target => {
      if (!target) {
        return;
      }
      binding.activate(target);
      return () => binding.deactivate();
    },
  );

  type SyncTargetTuple<TTarget> = readonly [
    target: TTarget | undefined,
    desiredLanguage: string | undefined,
  ];

  Solid.createEffect(
    (): SyncTargetTuple<TTarget> =>
      enabled()
        ? [options.target(), options.desiredLanguage()]
        : [undefined, undefined],
    ([target, desiredLanguage]) => {
      if (!target || !desiredLanguage) {
        binding.clearRequest();
        return;
      }
      binding.request(desiredLanguage);
    },
  );

  Solid.createEffect(
    (): SyncTargetTuple<TTarget> =>
      enabled() && typeof window !== 'undefined'
        ? [options.target(), options.desiredLanguage()]
        : [undefined, undefined],
    ([target, desiredLanguage]) => {
      if (!target || !desiredLanguage) {
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
    },
  );

  return (language: string) => binding.request(language);
}
