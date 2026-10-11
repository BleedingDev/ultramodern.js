---
'@modern-js/renderer-core': patch
---

Expire a stored native document by the shortest lifetime its confirmed delivery headers allow, and bypass the document cache when a request repeats `max-age`.
