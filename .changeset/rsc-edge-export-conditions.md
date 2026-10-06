---
'@modern-js/render': patch
'@modern-js/runtime': patch
'@modern-js/builder': patch
'@modern-js/app-tools-extensions': patch
---

`@modern-js/render/rsc` now selects the edge Flight runtime through the `workerd`, `worker` and `edge-light` export conditions and the Node runtime otherwise. The `@modern-js/render/rsc-worker` subpath and `@modern-js/runtime`'s `rsc/server.worker` build are removed; import `@modern-js/render/rsc` instead. Node server builds now use the Node Flight runtime, as upstream Modern.js does. The Cloudflare worker build no longer pins render, runtime, `react-server-dom-rspack/*.node` or TanStack `ssr/server` dist files through aliases.
