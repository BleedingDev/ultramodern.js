---
'@modern-js/renderer-core': patch
---

Native request dispatch stops waiting for a document cache lookup once the request is cancelled, so a stalled cache no longer keeps the request alive, and the cancellation is not reported as a cache error.
