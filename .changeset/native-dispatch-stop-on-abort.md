---
'@modern-js/renderer-core': patch
---

Native request dispatch stops waiting for a renderer handler once the request is cancelled, and discards that handler's late response, so a handler that ignores cancellation no longer keeps the request alive.
