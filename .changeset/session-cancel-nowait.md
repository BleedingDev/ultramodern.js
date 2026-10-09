---
'@modern-js/renderer-core': patch
---

A native request session now completes even when the handler's response stream never finishes cancelling, so worker `waitUntil` and Node cleanup no longer retain it; a cancellation error reported before completion is still recorded.
