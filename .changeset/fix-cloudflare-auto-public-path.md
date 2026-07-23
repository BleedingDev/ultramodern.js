---
'@modern-js/app-tools': patch
---

Normalize both serialized forms of Rspack's automatic public-path sentinel across generated HTML, Cloudflare loadable chunks, route assets, and federated remote CSS. CssExtract runtime lookups now compare canonical browser URLs so streamed SSR stylesheets are reused during hydration, while same-origin preload headers stay relative and do not leak internal Worker origins.
