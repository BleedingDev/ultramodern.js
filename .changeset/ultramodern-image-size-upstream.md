---
'@modern-js/ultramodern-create': patch
'@modern-js/image': patch
---

Use upstream image-size 2.0.4, which bounds malformed parser loops, instead of the patched `@bleedingdev/image-size` sidecar. `@bleedingdev/rsbuild-image-core` 0.1.4 requires the hardened `image-size ^2.0.3` and keeps its Sharp peer floor.
