---
"@modern-js/app-tools": patch
---

Fix Cloudflare module-worker BFF bundles so Effect API worker chunks keep their runtime exports.

Module-worker builds now keep export analysis enabled while still disabling tree-shaking passes that can break static runtime markers, and dispatch fallback BFF handlers without handler-arity branching.
