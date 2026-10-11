---
'@modern-js/renderer-core': patch
---

Reject public data RegExp values whose `lastIndex` is not 0, since the decoded RegExp would silently restart at 0.
