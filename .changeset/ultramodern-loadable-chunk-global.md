---
"@modern-js/runtime": patch
---

Preserve each application's configured chunk-loading global during string SSR builds and pass the same value to loadable hydration, preventing Module Federation remotes from sharing colliding chunk registries.
