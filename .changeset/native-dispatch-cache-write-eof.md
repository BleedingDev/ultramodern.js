---
'@modern-js/renderer-core': patch
---

A cached native document response now ends as soon as its body is delivered, without waiting for the cache write, so a stalled cache no longer holds the response open.
