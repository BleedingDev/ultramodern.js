---
'@modern-js/ultramodern-app-tools': patch
'@modern-js/i18n-runtime-extensions': patch
---

Native i18n locale resources named like Object members, such as a `__proto__.json` or `constructor.json` namespace, are now collected, emitted and loaded as plain keys.
