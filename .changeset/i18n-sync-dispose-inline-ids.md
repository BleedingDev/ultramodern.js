---
'@modern-js/renderer-core': patch
'@modern-js/i18n-runtime-extensions': patch
---

Return a disposer from native `syncWithRouter` and call it when the client entry is replaced or fails to start, so a retired entry stops syncing and persisting language, and reject repeated document inline-data ids.
