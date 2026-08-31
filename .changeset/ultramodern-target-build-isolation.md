---
'@modern-js/ultramodern-create': patch
---

Isolate generated UltraModern web and Cloudflare build output, temp, and Rspack
cache directories by app and build target so `build` and `cloudflare:build` can
run without sharing mutable build state.
