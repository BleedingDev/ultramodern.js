---
'@modern-js/renderer-core': patch
---

A native data action whose request is cancelled while its body is still being read now stops reading and cancels the body stream.
