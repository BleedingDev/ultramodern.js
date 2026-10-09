---
'@modern-js/renderer-core': patch
---

Prerendered static loader payloads are read like any data response: an aborted navigation cancels a pending payload body instead of waiting on it, and does not fall back to a server request.
