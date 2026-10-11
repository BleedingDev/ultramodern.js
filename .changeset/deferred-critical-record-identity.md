---
'@modern-js/renderer-core': patch
---

Deferred data keeps its critical record intact on the client: self-references and a null prototype survive while the deferred promises are attached.
