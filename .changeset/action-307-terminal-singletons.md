---
'@modern-js/renderer-core': patch
'@modern-js/renderer-solid': patch
'@modern-js/renderer-octane': patch
---

Fail native Solid and Octane actions on a 307/308 redirect instead of turning the mutation into a GET navigation, and keep a terminal response's singleton headers over loader metadata.
