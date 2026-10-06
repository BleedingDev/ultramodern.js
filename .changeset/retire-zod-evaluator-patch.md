---
'@modern-js/ultramodern-create': patch
'@modern-js/server-runtime-extensions': patch
---

Retire the `zod@4.6.5` evaluator-probe patch and the `@bleedingdev/zod` sidecar. Upstream zod already skips its `new Function` capability probe under `z.config({ jitless: true })` and on Cloudflare Workers, so framework packages now resolve plain upstream `zod`. Apps that enforce a CSP without `'unsafe-eval'` in the browser should call `z.config({ jitless: true })` before parsing.
