---
'@modern-js/runtime': patch
---

Streaming SSR buffers the shell in linear time. The Node and worker renderers rescanned the whole buffered shell for the end mark on every chunk, so a ~1 MB shell took 16-17 ms to reach the first byte instead of about 1 ms. They now scan only the new bytes plus a marker-sized overlap.
