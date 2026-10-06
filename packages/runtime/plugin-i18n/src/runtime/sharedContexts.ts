// Upstream-owned runtime modules take the i18n contexts from this fork-owned
// module, which reaches them through the shared
// `@modern-js/plugin-i18n/runtime/contexts` request. That keeps the fork
// import edge out of the upstream-owned files.
export {
  ModernI18nContext,
  ReactI18nextProviderContext,
} from '@modern-js/plugin-i18n/runtime/contexts';
