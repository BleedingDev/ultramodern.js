---
'@modern-js/ultramodern-app-tools': patch
'@modern-js/plugin-bff-build-extensions': patch
---

Minify `node` (SSR and backend) environments in production with function and class names kept, unless the app sets `output.minify`. Emit the release identity banner as string statements so a chunk's `"use strict"` stays in its directive prologue instead of silently running sloppy.
