---
'@modern-js/create': patch
'@modern-js/app-tools': patch
---

Patch generated UltraModern workspaces and migrations for the Module Federation React bridge stylesheet hydration dedupe fix, keeping SSR stylesheet links stable while avoiding duplicate client-mounted links.

Emit same-origin Cloudflare SSR route CSS links with route-manifest hrefs so client hydration recognizes already-rendered stylesheets while preserving absolute preload headers and remote federated CSS URLs.
