---
"@modern-js/ultramodern-create": patch
---

Fix UltraModern generated Module Federation remotes to publish their own dev
asset origin so host shells load `remoteEntry.js` and exposed chunks from the
remote dev server.
