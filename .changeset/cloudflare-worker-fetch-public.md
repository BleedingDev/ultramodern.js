---
'@modern-js/app-tools': patch
'@modern-js/ultramodern-create': patch
---

Enable Cloudflare's `global_fetch_strictly_public` compatibility flag for generated Worker deploys so SSR module-federation shells can fetch vertical manifests and CSS from deployed Worker URLs.
