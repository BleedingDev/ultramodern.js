---
'@modern-js/create': patch
---

Provision and verify the exact pnpm version bound by the immutable UltraModern
release manifest before downstream Tractor acceptance. This prevents an older
pnpm shim from the downstream workspace from overriding the release toolchain.
