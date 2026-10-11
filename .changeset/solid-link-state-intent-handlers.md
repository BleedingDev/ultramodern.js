---
'@modern-js/renderer-solid': patch
---

Solid `Link` now runs focus, blur, mouse and touch handlers supplied by `activeProps` or `inactiveProps`, after the caller's own handlers, with or without intent preloading.
