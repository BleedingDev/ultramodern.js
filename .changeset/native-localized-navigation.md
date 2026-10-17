---
'@modern-js/renderer-octane': patch
'@modern-js/renderer-solid': patch
---

Forward native search, params, hash, state, preloading and navigation options through localized links. Localized URL masks inherit the resolved canonical search and keep native active state. Remove the redundant useIsLocalizedActive export; use the native Link active state instead.
