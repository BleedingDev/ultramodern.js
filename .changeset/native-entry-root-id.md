---
'@modern-js/renderer-core': patch
---

Accept a matching `rootId` on the native server and client entries, so a document rendered into a custom mount element hydrates or mounts into it instead of failing to find `root`.
