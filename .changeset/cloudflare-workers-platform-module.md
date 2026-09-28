---
'@modern-js/app-tools-extensions': patch
---

Cloudflare worker bundles can import `cloudflare:workers`. It is externalized and accepted by the output verifier like `cloudflare:sockets`, so code built once per isolate can read bindings from the module-scope `env`.
