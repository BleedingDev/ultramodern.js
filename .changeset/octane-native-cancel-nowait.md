---
'@modern-js/renderer-octane': patch
---

Octane server rendering starts native stream cancellation without waiting for it during cleanup, errors and consumer cancellation, so a native stream that never finishes cancelling no longer holds the request session.
