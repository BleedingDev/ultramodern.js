---
'@modern-js/renderer-core': patch
---

The native data client cancels the body of a response it rejects before reading, such as a wrong content type, instead of leaving it downloading.
