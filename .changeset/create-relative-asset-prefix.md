---
'@modern-js/create': minor
---

Generated workspaces default `output.assetPrefix` to origin-relative `/` and set
`dev.assetPrefix: '/'` so apps served through tunnels and reverse proxies
(ngrok, cloudflared) no longer reference absolute localhost URLs, which
previously triggered Chrome's Local Network Access prompt. `ULTRAMODERN_PUBLIC_URL_<APP_ID>`
(per-app asset and deployment origin) and `MODERN_PUBLIC_SITE_URL` (site-wide
SEO origin) now have distinct precedence: assets prefer the per-app variable,
while canonical/hreflang/sitemap output uses the site-wide variable.
