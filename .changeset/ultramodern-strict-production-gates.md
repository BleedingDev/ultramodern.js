---
'@modern-js/ultramodern-create': patch
'@modern-js/app-tools': patch
'@modern-js/runtime': patch
'@modern-js/plugin-bff': patch
'@modern-js/create-request': patch
'@modern-js/server-utils': patch
'@modern-js/plugin-tanstack': patch
'@modern-js/plugin-i18n': patch
'@modern-js/types': patch
---

Fix generated UltraModern strict production gates by narrowing generated TypeScript and Module Federation DTS boundaries, patching the generated Effect declaration cohort, conditionally patching Drizzle declarations only for workspaces that use Drizzle, keeping app typechecks out of incoherent framework and third-party declaration graphs, preserving no-middleware BFF Effect clients as requirement-free, and ignoring Module Federation dev diagnostics.
