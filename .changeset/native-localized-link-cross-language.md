---
'@modern-js/i18n-runtime-extensions': patch
'@modern-js/renderer-solid': patch
'@modern-js/renderer-octane': patch
---

Solid and Octane `LocalizedLink` render a link to another language through the native router `Link`, so `preload`, `activeProps`, `inactiveProps` and `activeOptions` apply to it like any other link. Under the i18n router rewrite the link routes to the canonical target and publishes the other language's URL as a route mask; the i18n URL rewrite now keeps a language already present in an outgoing pathname, and the native entry's router language synchronization reads the masked URL. The i18next instance switches language from the navigated URL instead of from a click handler, and a failed language load no longer falls back to a document navigation.
