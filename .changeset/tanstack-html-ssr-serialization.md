---
"@modern-js/plugin-tanstack": patch
"@modern-js/runtime": patch
---

Avoid blocking normal TanStack HTML SSR on stream serialization completion. The HTML path now emits the buffered router bootstrap data without waiting for a streaming render-finished signal, preventing Cloudflare SSR route documents from stalling around the serializer timeout.
