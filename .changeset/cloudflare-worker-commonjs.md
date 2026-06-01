---
'@modern-js/app-tools': patch
---

Fix Cloudflare SSR deploy output so generated module-worker entries import the CommonJS worker bundles emitted by Modern.js SSR builds and unwrap nested default exports from Effect BFF bundles.
