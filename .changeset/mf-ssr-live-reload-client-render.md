---
'@modern-js/ultramodern-create': patch
---

Pin the `@bleedingdev/mf-modern-js-v3@2.9.2` sidecar. It keeps the Module
Federation SSR dev reload script out of client renders, so a federated remote
mounted with `createRoot` under React 19.3 no longer logs "Encountered a script
tag while rendering React component".
