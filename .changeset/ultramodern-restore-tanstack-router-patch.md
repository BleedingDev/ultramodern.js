---
'@modern-js/ultramodern-create': patch
---

Restore the required `@tanstack/router-core@1.171.21` declaration patch. The 1.171.21 dist ssr declarations still reference `MakeRouteMatch['__beforeLoadContext']`, which does not exist, so unpatched workspaces fail `skipLibCheck: false` builds. Fresh scaffolds ship the patch again and `ultramodern migrate-strict-effect` materializes it instead of retiring it.
