---
'@modern-js/renderer-core': patch
---

Route loaders returning deferred data now deliver a copy of the critical record that keeps its self-references and prototype, without mutating the loader's own object.
