---
'@modern-js/ultramodern-app-tools': patch
---

A native app with its own `index.server` entry can use `server.ssrByRouteIds`: the generated transport now forwards the entry's `nativeMatchRouteIds`, and names it in the error when the entry does not export one.
