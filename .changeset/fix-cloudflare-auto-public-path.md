---
'@modern-js/app-tools': patch
---

Normalize the Rspack `auto` public-path sentinel in the Cloudflare Worker chunk extractor so SSR emits origin-root asset URLs instead of broken `/auto/static/*` requests.
