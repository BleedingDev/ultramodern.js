---
'@modern-js/renderer-core': patch
'@modern-js/i18n-runtime-extensions': patch
'@modern-js/app-tools-extensions': patch
---

Vary unprefixed routed documents whose language was detected from request headers and keep them out of public caches, accumulate `Server-Timing` across matched loaders, and pass HEAD requests to the native Cloudflare dispatcher unchanged.
