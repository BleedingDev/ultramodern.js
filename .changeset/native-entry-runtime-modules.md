---
'@modern-js/ultramodern-app-tools': patch
'@modern-js/renderer-core': patch
'@modern-js/renderer-solid': patch
'@modern-js/renderer-octane': patch
'@modern-js/i18n-runtime-extensions': patch
---

Native Solid and Octane entries now run from typed runtime modules instead of generated source. The generated entries under `node_modules/.modern-js/<renderer>/<entry>` are stubs: `index.ts` calls `startNativeClient()` from `@modern-js/renderer-<renderer>/entry-client`, `index.server.ts` exports the handlers of `createNativeServerEntry()` from `@modern-js/renderer-<renderer>/entry-server`, `app.<client|server>.ts` holds only route source imports and route data, and `i18n.ts` calls `createNativeI18n()` from `@modern-js/i18n-runtime-extensions/native`. Shared startup, request, data and localization handling lives in `@modern-js/renderer-core/entry-client` and `/entry-server`, so Solid and Octane behave the same: both check the entry identity when matching routes for `ssrByRouteIds` and cancel startup when the entry is replaced. Apps that use `i18nPlugin()` install `i18next` and `@modern-js/i18n-runtime-extensions`, as before.
