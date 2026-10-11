---
'@modern-js/ultramodern-app-tools': minor
'@modern-js/app-tools-extensions': minor
'@modern-js/ultramodern-create': minor
'@modern-js/plugin': minor
'@modern-js/runtime': minor
'@modern-js/runtime-extensions': minor
'@modern-js/plugin-tanstack': patch
---

Resolve UltraModern workspace build and deployment policy in native fork packages from the existing topology and development overlay. Generated applications keep their authored Modern.js configuration when shells or verticals are added, and package updates deliver integration-policy fixes without regenerating application configs.

Expose native request preparation and completion hooks so router snapshot policy and resource disposal remain in fork-owned runtime plugins. Preserve existing `appTools()` defaults, native configuration overrides, redirects, SSR status and error reporting, and streamed response lifetimes.
