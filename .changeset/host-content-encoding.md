---
'@modern-js/ultramodern-app-tools': patch
'@modern-js/app-tools-extensions': patch
---

Never copy a configured `Content-Encoding` onto a native response, since the renderer owns its body's content coding.
