---
'@modern-js/plugin-tanstack': minor
---

feat(plugin-tanstack): emit canonical route type map in register.gen.d.ts

- codegen now emits `UltramodernCanonicalRoutes` interface in `register.gen.d.ts` derived from route files and i18n `localisedUrls` metadata
- localized physical variants (e.g. `/prednasky/$slug`) collapse to canonical pattern (`/talks/$slug`) and never appear in the map
- enables typed `Link` component `to` and `params` validation
- plain non-i18n apps are unaffected (no augmentation emitted)
