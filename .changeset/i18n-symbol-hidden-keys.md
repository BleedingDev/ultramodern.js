---
'@modern-js/ultramodern-app-tools': patch
---

Reject symbol-keyed and non-enumerable properties in `i18nPlugin()` `initOptions`, which JSON would silently drop.
