---
'@modern-js/app-tools-extensions': patch
'@modern-js/ultramodern-app-tools': patch
---

Write the Cloudflare native renderer identity header with the Node host's ASCII-only encoding so non-ASCII identities no longer throw, and reject `i18nPlugin()` `initOptions` arrays whose prototype is not `Array.prototype`.
