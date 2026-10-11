---
'@modern-js/ultramodern-app-tools': patch
---

Reject non-index array properties and own `__proto__` keys in `i18nPlugin()` `initOptions`, which JSON or the emitted module would drop or reinterpret.
