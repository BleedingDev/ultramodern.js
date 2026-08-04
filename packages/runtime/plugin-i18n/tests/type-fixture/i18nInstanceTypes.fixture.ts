import {
  type I18nInstance,
  useModernI18n,
} from '@modern-js/plugin-i18n/runtime';
import i18next, { type i18n } from 'i18next';

// WRITE direction — this is what had zero coverage and was broken before the
// top-level index signature was removed from `I18nInstance`. Eight integration
// fixtures (tests/integration/i18n/*/src/modern.runtime.tsx) write exactly
// this and none of them is ever typechecked; this file is the guard.
export const w1: I18nInstance = i18next.createInstance();
export const w2: I18nInstance = i18next;

// READ direction.
declare const inst: I18nInstance;
export const s: string = inst.t('k');
export const b: boolean = inst.exists!('k');
export const langs: readonly string[] = inst.languages!;
export const fixed: string = inst.getFixedT!('en')('k');

// W2 generic, both with and without an explicit type argument.
type StarlingLike = i18n & { setLang?: (l: string) => void | Promise<void> };
export function useTyped() {
  const r = useModernI18n<StarlingLike>();
  return r.i18nInstance.t('k') satisfies string;
}
export function useDefault() {
  return useModernI18n().i18nInstance.t('k') satisfies string;
}
