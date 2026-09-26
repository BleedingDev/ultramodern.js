---
'@modern-js/app-tools-extensions': patch
'@modern-js/runtime': patch
---

Cloudflare workers now bundle the real `@loadable/server` and the platform
`node:path` / `node:fs/promises` modules instead of in-repo reimplementations.
Loadable stats serialize Rspack's `auto` public path as `/`, so server-rendered
chunk tags never point at `auto/<file>` on Node or workerd.
