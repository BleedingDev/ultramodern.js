---
'@modern-js/create': patch
---

Let generated UltraModern applications inherit Rsbuild 2.2's environment-aware
split-chunk defaults. Browser Module Federation builds continue to use async
chunks while Node builds now receive Rsbuild's native server chunk splitting.
