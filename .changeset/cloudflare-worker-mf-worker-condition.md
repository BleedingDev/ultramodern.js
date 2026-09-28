---
'@modern-js/app-tools-extensions': patch
---

Cloudflare worker builds no longer alias Module Federation's SSR runtime plugins to a local no-op stub. The worker resolves them through `@module-federation/modern-js-v3`'s `worker` export condition (module-federation/core#5155), and the `ssr-dev-plugin` export is gone upstream of that (module-federation/core#5158).
