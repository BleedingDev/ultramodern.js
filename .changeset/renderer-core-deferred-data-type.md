---
'@modern-js/renderer-core': patch
---

Export the `DeferredDataResult` type returned by `deferData`, so loaders that return deferred data keep a nameable return type in declaration-emitting (composite) projects instead of failing with TS4058.
