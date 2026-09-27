---
'@modern-js/image': patch
---

Depend on upstream `@rsbuild-image/core` 0.0.1-next.36 instead of the `@bleedingdev/rsbuild-image-core` sidecar. Its `image-size ^2.0.1` range resolves the hardened 2.0.3+ on fresh installs; the dependency advisory gate catches lockfiles that pin an older release. `@modern-js/image` keeps its own `sharp ^0.35.4` dependency.
