import * as Solid from 'solid-js';
import type { I18nContextValue } from './types';

export type { I18nContextValue, I18nInstanceLike } from './types';

/**
 * Default-less form (Solid 2): `useContext` on this throws
 * `ContextNotFoundError` when no `I18nProvider` is mounted, instead of
 * silently reading a shared fallback instance across requests — exactly the
 * failure mode a per-request i18n instance needs. The context object is
 * itself the provider component: render `<I18nContext value={...}>`.
 */
export const I18nContext = Solid.createContext<I18nContextValue>();
