---
'@modern-js/builder': patch
'@modern-js/plugin-bff': patch
'@modern-js/plugin-i18n': patch
'@modern-js/plugin-tanstack': patch
'@modern-js/runtime': patch
---

Harden the UltraModern runtime and release gates after the strict TanStack
router generation release:

- preserve conventional and TanStack RSC route classification without leaking
  server-only route modules into client bundles;
- keep Effect BFF policy validation authoritative while supporting native
  request interception, non-default built entries, strict-pnpm dependency
  relocation, and ESM-only dependencies in CommonJS server artifacts;
- prevent i18n router subscriptions from remounting the router on fetcher-only
  state updates;
- isolate TanStack RSC server-route artifacts from conventional router output;
- restore the plugin-bff CLI default export and safely serialize loader errors.
