---
'@modern-js/ultramodern-app-tools': patch
---

Native prerendering assigns each route to the longest `server.baseUrl` it sits under on a path-segment boundary, so `/apple` is no longer treated as part of `/app` and the order of the base list no longer matters.
