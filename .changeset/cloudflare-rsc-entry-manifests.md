---
'@modern-js/app-tools-extensions': patch
---

Keep native RSC manifests in separate Cloudflare worker entry runtimes so loader-only entries cannot replace a page's client references and server consumer map.
