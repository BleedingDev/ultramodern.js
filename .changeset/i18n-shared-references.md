---
'@modern-js/ultramodern-app-tools': patch
---

Reject shared object references in `i18nPlugin()` `initOptions`, which the emitted JSON would split into separate copies.
