---
'@modern-js/create': patch
'@modern-js/app-tools': patch
'@modern-js/runtime': patch
'@modern-js/plugin-tanstack': patch
'@modern-js/plugin-i18n': patch
'@modern-js/types': patch
---

Fix generated UltraModern strict production gates by narrowing generated TypeScript and Module Federation DTS boundaries, patching the generated Effect declaration cohort, and keeping app typechecks out of incoherent framework and third-party declaration graphs.
