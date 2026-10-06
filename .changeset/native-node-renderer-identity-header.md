---
'@modern-js/renderer-core': patch
'@modern-js/ultramodern-app-tools': patch
---

Native Solid and Octane Node hosts (`ultramodern serve` / `dev`) now send the `x-ultramodern-renderer-identity` header naming the built entry that rendered, like the React host and the Cloudflare worker. The header name and its ASCII-only serializer are shared from `@modern-js/renderer-core/identity`.
