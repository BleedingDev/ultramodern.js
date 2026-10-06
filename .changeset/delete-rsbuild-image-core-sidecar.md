---
'@modern-js/image': patch
---

Depend on upstream `@rsbuild-image/core` 0.0.1-next.36 instead of the `@bleedingdev/rsbuild-image-core` sidecar. Its `image-size ^2.0.1` range resolves the hardened 2.0.3+ on fresh installs. A consumer lockfile that already pins image-size 2.0.1 or 2.0.2 is no longer forced up; `npm audit`/`pnpm audit` report it (GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr) and `pnpm update image-size` fixes it. `@modern-js/image` keeps its own `sharp ^0.35.4` dependency.
