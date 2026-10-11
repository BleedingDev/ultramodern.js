---
'@modern-js/renderer-core': patch
---

In development, loader and action errors that are `DOMException`s keep their name and message (for example `DataError: bad input`) instead of the generic server error, without running application getters.
