---
'@modern-js/renderer-core': patch
'@modern-js/i18n-runtime-extensions': patch
---

Native apps without a router now persist language changes too: the document language and the language cookie follow `changeLanguage()` in component-only entries, not just routed ones.
