---
'@modern-js/plugin-tanstack': patch
'@modern-js/runtime': patch
---

Deduplicate TanStack router runtime helpers through shared runtime seams, keep generated TanStack route files importing redirect/loader bridge helpers instead of inlining them, and fix TanStack RSC SSR route generation so client bundles import referenced root layouts, hydrate no-loader RSC routes, and preserve decoded composite payload values during client navigation.
