---
'@modern-js/ultramodern-app-tools': minor
'@modern-js/ultramodern-create': minor
'@modern-js/renderer-core': minor
'@modern-js/renderer-solid': minor
'@modern-js/renderer-octane': minor
'@modern-js/backend-federation-contracts': minor
'@modern-js/app-tools-extensions': patch
'@modern-js/runtime-extensions': patch
'@modern-js/app-tools': patch
'@modern-js/builder': patch
'@modern-js/runtime': patch
'@modern-js/runtime-utils': patch
'@modern-js/plugin': patch
'@modern-js/plugin-bff-build-extensions': patch
'@modern-js/plugin-data-loader': patch
'@modern-js/types': patch
'@modern-js/server-core': patch
'@modern-js/server': patch
'@modern-js/prod-server': patch
'@modern-js/utils': patch
---

Select the React, Solid 2 or Octane application stack with the renderer field in UltraModern configuration. Keep native component authoring, routing, compilation and hydration in the selected adapter, with shared request transport and per-entry build identity.

Generate selected application dependencies and native entries, validate renderer identity across generated artifacts and release envelopes, and reject unsupported preview capabilities before output generation. Shared tooling and declaration entry points no longer require an unselected renderer.

Check Octane templates and component props with native TypeScript 7.0.2 through `octane-tsc`, and generate the same stable compiler version for each renderer. Preserve automatic loader metadata reads and cached authored imports when capturing configuration inputs.
