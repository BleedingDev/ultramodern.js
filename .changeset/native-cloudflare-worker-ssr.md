---
'@modern-js/app-tools-extensions': patch
'@modern-js/ultramodern-app-tools': patch
'@modern-js/renderer-core': patch
'@modern-js/renderer-solid': patch
'@modern-js/renderer-octane': patch
---

Serve Solid and Octane documents, loader data and actions from the Cloudflare module worker through the same native server handler the Node host loads. The worker streams native HTML, forwards `env` as the worker platform binding and keeps request cleanup alive through `ctx.waitUntil`. Native renderers still reject RSC requests with 400. A Cloudflare deploy of a native renderer without `deploy.worker.ssr` now fails before writing output, and a worker route without a built renderer identity returns a JSON 500 instead of crashing the isolate.
