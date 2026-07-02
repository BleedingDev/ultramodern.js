---
'@modern-js/app-tools': patch
'@modern-js/plugin-bff': patch
---

Fix Cloudflare Effect BFF dispatch to use the framework Effect edge runtime so Worker env reaches `useEffectContext()`, and harden Cloudflare worker output for asset routing and Drizzle marker preservation.
