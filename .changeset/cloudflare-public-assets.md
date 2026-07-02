---
"@modern-js/app-tools": patch
---

Add `deploy.worker.publicAssets` for Cloudflare Worker Static Assets so apps can stage generated public data through framework configuration instead of mutating `.output/public` after deploy output generation.
