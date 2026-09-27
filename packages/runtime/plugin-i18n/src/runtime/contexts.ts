import type { ComponentType } from 'react';
import { createContext } from 'react';
import type { ModernI18nContextValue } from './context';
import type { I18nRouterAdapter } from './routerAdapter';

// Every other i18n runtime module imports these through
// `@modern-js/plugin-i18n/runtime/contexts` so Module Federation shares one
// copy of them. Their values stay provider-owned.
export const ModernI18nContext = createContext<ModernI18nContextValue | null>(
  null,
);
export const ReactI18nextProviderContext =
  createContext<ComponentType<any> | null>(null);
export const I18nNavigationContext = createContext<I18nRouterAdapter | null>(
  null,
);
