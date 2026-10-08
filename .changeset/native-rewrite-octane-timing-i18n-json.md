---
'@modern-js/ultramodern-app-tools': patch
'@modern-js/renderer-octane': patch
---

Keep middleware entry rewrites (`matchEntryName`/`matchPathname`) for native Node documents and apply the rewrite target's route headers, accumulate `Server-Timing` across nested Octane matches, and reject `i18nPlugin()` `initOptions` values that JSON would drop or alter.
