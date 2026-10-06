---
'@modern-js/app-tools-extensions': patch
'@modern-js/ultramodern-app-tools': patch
---

Let API-only MicroVerticals ship declared public assets on Node and Cloudflare. `deploy.node.publicAssets` stages app-root files under the Node `.output/public`, as `deploy.worker.publicAssets` does for Worker Static Assets, and the staged release envelopes record the files a declaration adds as `public-asset` artifacts instead of rejecting them as an undeclared UI/client surface. A declared file that replaces a generated public file keeps the generated classification. Declared sources must not contain symbolic links or stage the same file twice.
