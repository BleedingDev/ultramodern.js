---
'@modern-js/plugin-i18n': patch
---

Avoid fixed SSR latency from backend resource polling after i18next initialization. Chained backend refreshes now update through their own loaded events instead of blocking HTML route rendering.
