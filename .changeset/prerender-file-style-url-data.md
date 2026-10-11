---
'@modern-js/ultramodern-app-tools': patch
---

Fail native SSG with a clear message when a file-style URL such as `/guide.html` has loader data, instead of an `ENOTDIR` error writing its payload.
