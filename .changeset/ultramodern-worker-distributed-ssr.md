---
"@modern-js/app-tools": patch
"@modern-js/create": patch
---

Generate a Worker-specific shell composition module that renders MicroVerticals through distributed SSR boundaries, and exclude the native Module Federation runtime from Cloudflare Worker server bundles so remote startup never performs forbidden global-scope I/O.
