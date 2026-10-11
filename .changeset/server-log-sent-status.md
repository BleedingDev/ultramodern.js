---
'@modern-js/server-core': patch
---

Log the response status that is actually sent. A native or Response-returning handler's 404 was logged as the Node response's default 200.
