---
'@modern-js/app-tools': patch
'@modern-js/runtime-utils': patch
---

Keep SSR JSON serialization deterministic at module initialization so Cloudflare Workers can load Modern.js render bundles without forbidden global-scope randomness, and preserve HTML response bodies when Cloudflare SSR routes have no CSS links to inject.
