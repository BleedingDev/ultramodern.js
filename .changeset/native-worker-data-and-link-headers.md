---
'@modern-js/app-tools-extensions': patch
'@modern-js/renderer-core': patch
---

Answer native Cloudflare loader requests through the native dispatcher instead of the legacy React route-data worker, and accumulate `Link` headers across matched loaders.
