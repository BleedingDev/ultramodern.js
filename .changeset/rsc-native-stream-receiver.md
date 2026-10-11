---
"@modern-js/render": patch
---

Preserve the transformed native ReadableStream and its React readiness promise when injecting Flight into SSR HTML, so workerd can consume the stream with native readers and pipes.
