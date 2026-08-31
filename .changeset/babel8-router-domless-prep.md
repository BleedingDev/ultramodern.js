---
'@modern-js/app-tools': patch
'@modern-js/ultramodern-create': patch
'@modern-js/plugin-ssg': patch
'@modern-js/runtime': patch
'@modern-js/runtime-utils': patch
'@modern-js/types': patch
---

Prepare React Router package usage for the DOM-less package layout.

Generated UltraModern workspaces now depend on `react-router` directly without
a direct `react-router-dom` dependency, and the root runtime-utils/dev-server
React Router 8 prep lane now pins
`react-router` 8.1.0. The app-tools preset aliases an app-local `react-router`
while retaining a v7 fallback through `react-router-dom`. The runtime compile
include list no longer names `react-router-dom`, plugin-ssg no longer declares
the stale optional peer, and `@modern-js/types` declares its public
`@jest/types` dependency directly.
