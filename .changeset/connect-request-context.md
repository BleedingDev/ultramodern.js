---
'@modern-js/server-core': patch
---

Keep request context when asynchronous Connect middleware resumes after compilation, and prevent a late callback from continuing a finished response.
