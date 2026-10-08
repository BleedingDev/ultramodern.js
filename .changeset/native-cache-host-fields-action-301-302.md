---
'@modern-js/renderer-core': patch
'@modern-js/renderer-solid': patch
'@modern-js/renderer-octane': patch
---

Store a cached native document with the renderer's own headers so host route and middleware headers are not repeated on a cache hit, and fail native Solid and Octane actions on a 301/302 redirect after a non-POST mutation.
