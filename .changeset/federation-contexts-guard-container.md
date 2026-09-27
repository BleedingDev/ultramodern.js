---
'@modern-js/ultramodern-app-tools': patch
---

The private-contexts guard checks only compilations that build a Module Federation container. The Cloudflare workerd SSR graph drops the federation plugin after the chain is configured, so its direct context imports no longer fail the vertical's `cloudflare:build`.
