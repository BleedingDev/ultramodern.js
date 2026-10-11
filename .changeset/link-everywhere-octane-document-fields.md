---
'@modern-js/renderer-core': patch
'@modern-js/renderer-solid': patch
'@modern-js/renderer-octane': patch
'@modern-js/ultramodern-app-tools': patch
'@modern-js/app-tools-extensions': patch
---

Accumulate `Link` at every native header merge (Octane matches, Solid component headers, Node middleware and route config, Cloudflare route headers), keep `Content-Language` and other document fields an Octane route declares, and read document cache directives by exact token.
