---
'@modern-js/renderer-solid': patch
'@modern-js/renderer-octane': patch
---

A `changeLanguage()` call whose language finishes loading after a newer call no longer navigates, and puts back the newer language if its slow load replaced it.
