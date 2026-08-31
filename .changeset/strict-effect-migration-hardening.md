---
'@modern-js/app-tools': patch
'@modern-js/code-tools': patch
'@modern-js/ultramodern-create': patch
'@modern-js/plugin-bff': patch
---

Harden UltraModern strict Effect API migrations: generated workspaces now pin the compatible Effect cohort, isolate Rspack build caches per app/target, expose strict Effect migration tooling, enforce direct API topology and concrete schemas through generated checks/Oxlint, provide edge-safe Effect context/test helpers, and support declarative Cloudflare D1 bindings.
