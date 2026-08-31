---
'@modern-js/ultramodern-create': patch
'@modern-js/plugin-bff': patch
---

Bundle symlinked workspace source packages into compiled Effect BFF entries so final Node deployment output never depends on raw TypeScript under `node_modules`.

Make generated Node backend-federation proof commands own the built runtime lifecycle, and migrate legacy custom API marker schemas to preserve complete MicroVertical release identity.

Make generated Workerd proofs execute shell-owned Cloudflare service-binding API checks against the matching legacy MicroVertical instead of requiring duplicate per-vertical deploy metadata.
