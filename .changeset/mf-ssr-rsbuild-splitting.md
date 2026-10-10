---
'@modern-js/ultramodern-create': patch
---

Repair Module Federation Node chunk startup readiness and remove the server
splitting restriction. Server bundles now use the normal Rsbuild splitting
configuration with asyncStartup enabled.
