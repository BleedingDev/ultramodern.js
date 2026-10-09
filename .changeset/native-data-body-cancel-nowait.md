---
'@modern-js/renderer-core': patch
'@modern-js/ultramodern-app-tools': patch
---

Discarded response bodies (data redirects, HEAD data responses, missed static payloads, failed streams and prerender captures) are now cancelled without waiting on the stream's cancel hook, so a stalled cancel never holds a response or build.
