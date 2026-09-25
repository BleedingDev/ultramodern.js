---
"@modern-js/app-tools-extensions": patch
"@modern-js/server-runtime-extensions": patch
---

Run route data loaders in-process in the Cloudflare worker and answer `?__loader=` route data requests there like the Node server's data handler: the same route IDs and localized route identity, the same loader and action arguments and request context, and the same JSON, deferred, redirect, thrown Response and error responses. The worker previously rendered with browser route loaders that fetched its own `?__loader=` URL, which it answered by rendering the page again until the request failed. The worker route data handler does not import react-router, so data loader apps keep passing `modern deploy` output verification.
