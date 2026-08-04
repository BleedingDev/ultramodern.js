---
'@modern-js/plugin-i18n': major
---

fix(plugin-i18n): make `I18nInstance` assignable from an i18next instance

The documented and most common usage, `runtime: { i18n: { i18nInstance: i18next } }`,
did not typecheck: `Type 'i18n' is not assignable to type 'I18nInstance'`. The cause
was the interface's top-level `[key: string]: unknown` — TypeScript never grants an
interface an implicit index signature — plus overloaded call-signature properties,
whose bivariance turned out to be order-dependent across program compositions.

`I18nInstance` now declares the i18next members it needs explicitly (`t`, `exists`,
`getFixedT`, `hasLoadedNamespace`, `dir`, `format`, `languages`, `resolvedLanguage`,
`loadNamespaces`, `loadLanguages`, `addResourceBundle`, `getResourceBundle`,
`getDataByLanguage`), uses single non-overloaded method signatures, and is re-exported
from `@modern-js/plugin-i18n/runtime` alongside `TranslateFn` and
`UseModernI18nReturn`. `useModernI18n` accepts an optional type argument
(`useModernI18n<MyInstance>() where MyInstance extends I18nInstance`) that types
the returned `i18nInstance`; within that constraint it is a caller assertion, not
a runtime check.

BREAKING: `t` is now a REQUIRED member of `I18nInstance`. Upstream declared no `t`
at all, so any code that produces an `I18nInstance` from an object literal (custom
or minimal instances, test doubles) must now supply one. Real i18next instances are
unaffected. Consequently `useModernI18n().i18nInstance` from an uninitialised
provider now carries a `t` that THROWS `i18nInstance.t required` when called, where
previously the property was absent: feature detection of the form
`if (i18nInstance.t)` / `i18nInstance.t?.(key)` used to take the absent branch and
now enters it. Guard on `i18nInstance.isInitialized` instead.

BREAKING: `I18nInstance` no longer declares `[key: string]: unknown`. Reading a
property that is not declared on the interface is now a type error (TS2339); cast to
the concrete instance type instead. `services.languageDetector`, `options.detection`
and `options.backend` are now `any`, so `src/runtime/i18n/utils.ts` and
`backend/middleware.common.ts` read and write through `options.backend` unchecked, and
`init`/`createInstance`/`cloneInstance` take `any` options instead of
`I18nInitOptions`. These are accepted costs of assignability.
