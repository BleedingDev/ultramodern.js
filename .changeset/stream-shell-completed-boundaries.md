---
'@modern-js/runtime': patch
---

Streaming SSR keeps completed Suspense boundaries inside the shell. React writes a large completed boundary after the shell once the flushed bytes exceed `progressiveChunkSize`. The document head is sealed from the shell, so every large route lost its `Helmet` tags and was served without `<title>`, meta description, canonical and alternate links, or `<html lang>`, and its content stayed hidden until the inline `$RC` script ran. The Node and worker stream renderers now keep completed boundaries inline; pending boundaries still stream when they resolve.
