---
'@modern-js/plugin-tanstack': patch
'@modern-js/ultramodern-create': patch
---

The generated route metadata manifest now type-checks when an app's only route is not the root. `as const` narrows each `canonicalPath` to its literal, so `route.canonicalPath !== '/'` in the localised-URL filter failed with TS2367 when no route was `/`. The filter parameter is now typed as `{ canonicalPath: string }`.
