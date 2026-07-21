---
'@modern-js/create': patch
'@modern-js/app-tools': patch
---

Patch generated UltraModern workspaces and migrations for the Module Federation React bridge stylesheet hydration dedupe fix, keeping SSR stylesheet links stable while avoiding duplicate client-mounted links.

Make the Modern.js Module Federation React adapter delegate federated stylesheet
injection to the Modern server runtime by default. Explicit adapter callers can
still opt into bridge-owned links, while generated SSR applications keep one
stylesheet owner before and after hydration.

Emit same-origin Cloudflare SSR route CSS links with route-manifest hrefs so client hydration recognizes already-rendered stylesheets while preserving absolute preload headers and remote federated CSS URLs.
