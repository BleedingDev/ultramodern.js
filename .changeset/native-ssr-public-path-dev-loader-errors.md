---
'@modern-js/server-runtime-extensions': patch
'@modern-js/renderer-core': patch
---

Served federation manifests now make a root-relative `ssrPublicPath` absolute at the serving origin, so server-rendering hosts can load a native remote's Node container. Native development servers now keep loader error messages for SSR and data requests; any other mode still hides them.
