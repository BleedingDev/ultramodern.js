---
'@modern-js/image': patch
---

Serve the dev image route `/_modern/ipx` from `@modern-js/image` on upstream `ipx` 4, which resolves the hardened `sharp` 0.35 line and passes sharpen options in sharp's object form. The `@bleedingdev/ipx` sidecar is retired, and `@rsbuild-image/core` no longer loads `ipx`.
