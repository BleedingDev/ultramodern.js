---
'@modern-js/ultramodern-create': patch
---

Bound release-age registry metadata audits to 16 concurrent requests and retry
transient transport and server failures before failing closed. This prevents
large generated workspaces from overwhelming the registry while preserving
exact integrity and publication-time verification.
