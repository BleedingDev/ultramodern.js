---
'@modern-js/ultramodern-create': patch
---

Resolve Cloudflare proof Module Federation manifest `publicPath` values against
the manifest URL before comparing the remote asset base, so valid relative
values such as `/` pass while wrong absolute origins still fail.
