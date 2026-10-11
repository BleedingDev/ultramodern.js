---
'@modern-js/ultramodern-app-tools': patch
'@modern-js/app-tools-extensions': patch
---

Keep the renderer's body framing (`Content-Length`, `Transfer-Encoding`, and an existing `Content-Encoding`) when Node middleware, route config or Cloudflare route headers merge into a native response, and reject `-0` in `i18nPlugin()` `initOptions`.
