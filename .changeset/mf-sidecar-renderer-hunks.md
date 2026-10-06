---
'@modern-js/ultramodern-create': patch
---

Publish the renderer Module Federation hunks under new sidecar versions. `@bleedingdev/mf-modern-js-v3@2.9.3` and `@bleedingdev/mf-dts-plugin@2.9.2` are already on npm without the router-free `/base` bridge entry and the native DTS worker witness (`dts.onDevWorkerCreated`), and published versions are immutable. The dts-plugin moves to 2.9.3; mf-cli, mf-manifest, mf-rspack, mf-enhanced and mf-rsbuild-plugin move to 2.9.3 and mf-node to 2.7.53 because their manifests pin the changed children; generated apps pin `@bleedingdev/mf-modern-js-v3@2.9.4`.
