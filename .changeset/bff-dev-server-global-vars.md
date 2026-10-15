---
'@modern-js/plugin-bff-extensions': patch
'@modern-js/plugin-bff-build-extensions': patch
'@modern-js/runtime-extensions': patch
'@modern-js/server-runtime-extensions': patch
---

Apply `source.globalVars` when Effect BFF source is loaded in dev and when its HttpApi contract is read, using the same serializer as the BFF build. The serializer is exported from `@modern-js/plugin-bff-extensions/server-global-vars`, and the server config now types `source.globalVars`.
