---
'@modern-js/ultramodern-create': minor
---

Drive `ultramodern-create ultramodern cloudflare-ssr-proof` from the workspace topology. Every UI app is now proven on its own Worker at its declared `cloudflare.routes.ssr` (plus `cloudflare.distributedSsrProofRoutes`) instead of a hard-coded `/en`, and the report records these runs as `verticalProofs`.

Shells still must server-render a verified boundary for every referenced MicroVertical that declares a distributed SSR expose, on `cloudflare.distributedSsrProofRoutes` or, when that is absent, on `cloudflare.routes.ssr`. A shell whose MicroVerticals load on the client declares `distributedSsrProofRoutes: []`.

Shell composition runs in one Miniflare instance, while each vertical route runs in its own runtime so it serves its own assets; service bindings still resolve through the shared runtime. Each Worker receives its Wrangler `vars` and the `.dev.vars` file beside its executed `wrangler.json`, matching `wrangler dev`.
