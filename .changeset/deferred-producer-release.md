---
'@modern-js/renderer-core': patch
---

A cancelled deferred data stream no longer waits for deferred work that ignores cancellation, so its producer and request data are released.
