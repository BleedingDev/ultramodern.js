---
'@modern-js/renderer-core': patch
'@modern-js/ultramodern-app-tools': patch
'@modern-js/app-tools-extensions': patch
---

Merge configured route response headers into native Node documents with cumulative CSP, unioned `Vary` and appended cookies, let native Cloudflare worker routes resolve their locale in the native handler, and strip loader `Content-Location` from data envelopes and SSR documents.
