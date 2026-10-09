---
'@modern-js/renderer-core': patch
---

Native server entries stop waiting for the application module and translations once the request aborts, so a stalled load no longer holds the request, context and session.
