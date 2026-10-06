---
'@modern-js/ultramodern-create': patch
---

`ultramodern cloudflare-proof` sends a Cloudflare Access service token on every
probe when `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` are set, so it can
prove deployments that sit behind Access. Setting only one of them fails before
any request.
