---
"@modern-js/app-tools": patch
"@modern-js/app-tools-extensions": patch
"@modern-js/backend-federation-contracts": patch
"@modern-js/bff-effect": patch
"@modern-js/code-tools": patch
"@modern-js/federation-runtime": patch
"@modern-js/i18n-runtime-extensions": patch
"@modern-js/plugin-bff-build-extensions": patch
"@modern-js/plugin-bff-extensions": patch
"@modern-js/plugin-data-loader": patch
"@modern-js/plugin-i18n": patch
"@modern-js/plugin-tanstack": patch
"@modern-js/runtime": patch
"@modern-js/runtime-extensions": patch
"@modern-js/server-runtime-extensions": patch
"@modern-js/surface-resolution": patch
"@modern-js/ultramodern-app-tools": patch
"@modern-js/ultramodern-create": patch
"@modern-js/utils": patch
---

Consolidate fork-owned workspace validation, route and navigation contracts, BFF metadata, federation transport, and build resolution while preserving current generated application and runtime behavior. Generated validation now runs from the installed package, router preparation owns cancellation and disposal, and remote address resolution uses one policy in generated and runtime configuration.

Fix packed route generation from app-owned dependencies and repair Module Federation CLI ESM bindings while keeping optional DTS loading lazy.

Preserve router identity across rerenders and delayed i18n setup, and match translated loader URLs against canonical TanStack route metadata. Correct Windows compiler paths, plugin imports, and generated i18n runtime aliases.

Load native ESM CLI plugins through file URLs and launch absolute Module Federation DTS compiler executables without shell parsing on Windows. Decode resolved ESM file URLs to native paths, including Windows short names and special characters.
