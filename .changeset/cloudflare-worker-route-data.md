---
"@modern-js/app-tools-extensions": patch
"@modern-js/server-runtime-extensions": patch
---

Run route data loaders in-process in the Cloudflare worker and answer `?__loader=` route data requests there with the same localized route identity as the Node server. The worker previously rendered with browser route loaders that fetched its own `?__loader=` URL, which it answered by rendering the page again until the request failed.
