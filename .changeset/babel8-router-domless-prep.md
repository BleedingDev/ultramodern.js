---
'@modern-js/app-tools': patch
'@modern-js/create': patch
'@modern-js/plugin-ssg': patch
'@modern-js/runtime': patch
'@modern-js/types': patch
---

Prepare React Router package usage for the DOM-less package layout.

Generated UltraModern workspaces now depend on `react-router` directly, and
the app-tools preset aliases an app-local `react-router` while retaining a v7
fallback through `react-router-dom`. The runtime compile include list no
longer names `react-router-dom`, plugin-ssg no longer declares the stale
optional peer, and `@modern-js/types` declares its public `@jest/types`
dependency directly.
