---
'@modern-js/app-tools': patch
---

Normalize both serialized forms of Rspack's automatic public-path sentinel across generated HTML, Cloudflare loadable chunks, route assets, and federated remote CSS so SSR emits origin-root asset URLs instead of broken or duplicated `/auto/static/*` links.
