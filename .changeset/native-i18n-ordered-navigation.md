---
'@modern-js/renderer-solid': patch
'@modern-js/renderer-octane': patch
---

Overlapping `changeLanguage()` calls now navigate in call order, so a slow older navigation can never leave its URL after a newer language switch.
