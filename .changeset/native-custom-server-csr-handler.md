---
'@modern-js/ultramodern-app-tools': patch
---

A native app's own `index.server` entry can export a separate `nativeCSRRequestHandler`; the generated transport now uses it for client-rendered documents, such as routes outside `server.ssrByRouteIds`.
