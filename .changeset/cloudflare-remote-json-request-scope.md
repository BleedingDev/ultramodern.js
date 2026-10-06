---
'@modern-js/app-tools-extensions': patch
---

Stop sharing in-flight remote manifest fetches across Worker requests; cache only settled JSON and dedupe in-flight fetches per request.
