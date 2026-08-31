---
'@modern-js/ultramodern-create': patch
---

Make generated UltraModern Cloudflare proof and Module Federation remote asset
defaults deployment-safe: the proof uses a two-segment missing route that is not
captured by locale root routes, and generated remote apps default their
`output.assetPrefix` to their own public Worker/local origin so browser
hydration loads remote entries and chunks from the remote app.
