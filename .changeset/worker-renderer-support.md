---
'@modern-js/app-tools-extensions': patch
---

The Cloudflare worker decides how to serve a renderer's documents from the `worker` support recorded in `renderer-build.json` instead of a fixed list of renderer names. The worker manifest now carries the built renderer as `renderer: { name, nativeDocuments, rsc }`, and only that renderer's UI metadata is admitted. Builds made before this change must be rebuilt before a Cloudflare deploy.
