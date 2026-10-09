---
'@modern-js/renderer-core': patch
---

Loader and action data now reject plain objects with non-enumerable properties instead of silently dropping those properties on the client.
