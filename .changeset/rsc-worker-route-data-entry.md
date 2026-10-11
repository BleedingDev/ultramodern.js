---
'@modern-js/app-tools': patch
---

Cloudflare worker builds with `server.rsc` no longer emit an empty `<entry>-server-loaders.js` worker bundle. The browser-only RSC loader placeholder was also added to the worker environment, so deploy rejected the bundle for missing `handleRouteDataRequest` (or the placeholder shadowed the real route data handler).
