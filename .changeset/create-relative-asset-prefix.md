---
'@modern-js/ultramodern-create': minor
---

Generated workspaces default `output.assetPrefix` to origin-relative `/` and set
`dev.assetPrefix: '/'` so apps served through tunnels and reverse proxies
(ngrok, cloudflared) no longer reference absolute localhost URLs, which
previously triggered Chrome's Local Network Access prompt. `MODERN_PUBLIC_SITE_URL`
is now documented as canonical/SEO-only, while JS/CSS/static assets use
`MODERN_ASSET_PREFIX`, then `ULTRAMODERN_ASSET_PREFIX`, then `/`; stale public
URL aliases should not be carried forward as asset-prefix fallbacks. Generated
workspace documentation also records the Node `>=26` plus pnpm `11+`
toolchain baseline.
