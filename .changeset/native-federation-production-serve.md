---
'@modern-js/ultramodern-app-tools': patch
---

`ultramodern serve` now serves a native (Solid or Octane) remote's `mf-manifest.json`, `remoteEntry.js`, exposed chunks and SSR Node container with the same CORS and cache headers as a React remote, instead of answering 404.
