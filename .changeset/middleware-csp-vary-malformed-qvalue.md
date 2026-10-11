---
'@modern-js/ultramodern-app-tools': patch
'@modern-js/i18n-runtime-extensions': patch
---

Append Content-Security-Policy fields and union `Vary` when Node middleware headers merge into a native response, and ignore `Accept-Language` ranges with a malformed quality so they cannot shadow broader ranges.
