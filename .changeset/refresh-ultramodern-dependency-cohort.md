---
'@modern-js/code-tools': patch
'@modern-js/ultramodern-create': patch
'@modern-js/app-tools': patch
'@modern-js/plugin-bff': patch
'@modern-js/plugin-tanstack': patch
'@modern-js/sandpack-react': patch
---

Refresh the UltraModern toolchain and generated workspace dependency cohort,
including pnpm 11.24, the latest Oxc and Ultracite releases, Module Federation
2.9, the compatible Effect release candidate, and current TanStack Router
packages. Retire obsolete Effect declaration patching while preserving safe
migration of previously generated workspaces.
Align the Sandpack Modern Web App template's React DOM range with React 19.2.8.
