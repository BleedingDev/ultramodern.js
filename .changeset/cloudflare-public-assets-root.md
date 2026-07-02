---
'@modern-js/app-tools': patch
---

Allow Cloudflare Worker `deploy.worker.publicAssets` entries to use `to: '.'` so apps can stage generated public-surface assets into the Worker Static Assets root declaratively, without post-build output rewrites.
