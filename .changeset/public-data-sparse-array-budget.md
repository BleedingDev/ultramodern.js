---
'@modern-js/renderer-core': patch
---

Loader and action data now count the holes of sparse arrays toward the public-data node limit, so a huge sparse array is rejected before serialization instead of exhausting the server.
