---
'@modern-js/ultramodern-create': patch
'@modern-js/runtime': patch
---

Fix UltraModern Cloudflare SSR output so route-critical commerce pages render full visible markup for users without JavaScript.

The generated workspace now serves demo commerce images as public assets instead of inlining SVG imports into streamed route markup, and streaming SSR route generation uses synchronous route components when route chunks are disabled.
