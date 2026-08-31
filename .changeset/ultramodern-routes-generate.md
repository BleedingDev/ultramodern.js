---
'@modern-js/ultramodern-create': patch
'@modern-js/plugin-tanstack': patch
---

Add a headless `routes-generate` UltraModern tooling command that regenerates
TanStack route artifacts (router.gen.ts, register.gen.d.ts) without running dev
or build, via the new `generateTanstackRouteArtifacts` export.
