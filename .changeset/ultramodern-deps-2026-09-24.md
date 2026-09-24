---
'@modern-js/ultramodern-create': minor
'@modern-js/bff-effect': minor
'@modern-js/app-tools': patch
'@modern-js/app-tools-extensions': patch
'@modern-js/builder': patch
'@modern-js/code-tools': patch
'@modern-js/runtime': patch
---

Move the dependency cohort to the newest matured releases: Effect 4.0.0-rc.117, Module Federation 2.9.1, Zod 4.6.5, React 19.3, Rsbuild 2.2.9 and current tooling. TanStack Router 1.170.39, Wrangler 4.137.0 with Miniflare 5 and workerd 1.20260921.1 are included.

Effect 4.0.0-rc.117 no longer ships MessagePack RPC serialization, so the `msgPack` Effect RPC serialization option and the msgpackr patch and sidecar are removed. Effect is published as a patched sidecar whose router builds params without string code generation.

Cloudflare output verification ignores files that concurrent builds delete while the mutation scan runs.
