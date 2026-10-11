---
'@modern-js/renderer-solid': patch
---

Stop a Solid router Link from throwing when `activeProps` or `inactiveProps` name `ref` or `onClick`; the Link keeps its own handlers.
