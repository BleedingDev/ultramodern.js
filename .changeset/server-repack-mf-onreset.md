---
'@modern-js/server': patch
---

The dev server no longer resets the Module Federation runtime itself on repack. `@module-federation/modern-js-v3/server` does it in its `onReset` handler through runtime-core's `resetFederationRuntime` (module-federation/core#5152), which the `@bleedingdev/mf-*` sidecars carry.
