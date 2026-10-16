import { createElement, hookSlots, useSyncExternalStore } from 'octane';
import { I18nContext } from './context';
import type { I18nContextValue } from './types';

export interface I18nProviderProps extends Omit<I18nContextValue, 'language'> {
  children?: unknown;
}

/**
 * Provides a per-request i18next-shaped instance to the Octane tree. The
 * instance must come from the caller (created with `cloneInstance` per
 * request on the server, and the same instance reused on hydration) — this
 * provider holds no module-level state of its own beyond the one reactive
 * `language` state it derives from `instance` and shares with every
 * consumer through context, matching `@modern-js/plugin-i18n`'s React
 * `ModernI18nProvider` shape (one subscription, pushed through context,
 * rather than every consumer subscribing to `languageChanged` itself).
 *
 * No JSX: built with `createElement`, matching this package's existing
 * style (see `src/routes.ts`), and avoiding any dependency on Octane's
 * JSX/compiler toolchain for a file that needs none of its features.
 */
// Plain TypeScript is not rewritten by the Octane compiler, so each hook call
// site carries its own stable slot, like `OctaneRouterRoot`.
const languageStoreSlot = Symbol(hookSlots(1));

export function I18nProvider(props: I18nProviderProps) {
  const instance = props.instance;
  const language = useSyncExternalStore(
    notify => {
      instance.on?.('languageChanged', notify);
      return () => instance.off?.('languageChanged', notify);
    },
    () => instance.language,
    () => instance.language,
    languageStoreSlot,
  );

  const value: I18nContextValue = {
    instance: props.instance,
    languages: props.languages,
    localisedUrls: props.localisedUrls,
    language,
  };

  return createElement(I18nContext, { value, children: props.children });
}
