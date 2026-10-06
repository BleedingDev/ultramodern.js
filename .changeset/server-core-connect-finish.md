---
'@modern-js/server-core': patch
---

Settle a three-argument connect middleware, such as a `dev.setupMiddlewares` handler, when it answers the request without calling `next`, instead of leaving its Hono middleware promise pending.
