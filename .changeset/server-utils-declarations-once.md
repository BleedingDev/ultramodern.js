---
'@modern-js/server-utils': patch
---

Emit server declarations once per compile instead of once per pass. Server
code that reaches app sources outside its source directories compiles in
several passes, and each pass used to run the full TS-Go declaration emit for
the same program. The declarations are unchanged.
