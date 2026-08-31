---
'@modern-js/ultramodern-create': patch
---

Repair the Module Federation runtime-core 2.9.0 remote declaration by importing
its public `ResourceLoadContext` type. Generated and migrated UltraModern
workspaces now carry the same pnpm patch and validate it under strict library
checking.
