---
'@modern-js/renderer-solid': patch
---

The Solid `Link` now warns in development when `activeProps` or `inactiveProps` returns a key it did not return when the Link was created; values of keys returned from the start stay reactive.
