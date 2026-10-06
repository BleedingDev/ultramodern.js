---
'@modern-js/server': patch
---

Render page routes in dev instead of serving HTML templates as static assets when html.distPath places the template at the output root, so dev matches production SSR and locale redirects.
