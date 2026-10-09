---
'@modern-js/renderer-core': patch
---

Native data loaders and actions stop waiting for a handler once its request aborts, and cancel the body of a Response that arrives as the request aborts.
