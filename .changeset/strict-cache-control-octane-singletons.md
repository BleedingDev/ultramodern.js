---
'@modern-js/renderer-core': patch
'@modern-js/renderer-octane': patch
---

Parse Cache-Control strictly and fail closed on malformed fields for both loader metadata and the document cache, and let an Octane route's singleton `headers()` fields replace loader values while list fields keep both.
