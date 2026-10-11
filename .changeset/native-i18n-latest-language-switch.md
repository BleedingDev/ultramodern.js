---
'@modern-js/renderer-solid': patch
'@modern-js/renderer-octane': patch
---

When `changeLanguage()` calls overlap, only the latest one restores the previous language after a failed or blocked navigation, so an older failure cannot undo a newer successful switch.
