---
'@modern-js/bff-core': patch
---

Remove the unused tsconfig-paths peer and development dependency. The public BFF package uses its own path matcher and no longer requires applications to install an unused package.
