---
'@modern-js/renderer-core': patch
---

A replaced (HMR-disposed) native client entry stops waiting for its initial router load, so a route loader that ignores cancellation no longer keeps the old entry and router alive, for every renderer.
