---
'@modern-js/app-tools-extensions': patch
---

The Cloudflare worker's rendering stream passes errors and cancellations on without waiting for the source stream's cancel hook, which may never settle.
