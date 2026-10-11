---
'@modern-js/renderer-solid': patch
'@modern-js/renderer-octane': patch
---

Overlapping `changeLanguage()` calls always end on the newest call's language, even when an older call's load, correction or restore finishes last.
