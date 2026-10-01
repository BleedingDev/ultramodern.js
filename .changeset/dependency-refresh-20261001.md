---
'@modern-js/app-tools': patch
'@modern-js/utils': patch
'@modern-js/ultramodern-create': patch
'@modern-js/ultramodern-sandpack-profile': patch
'@modern-js/plugin-bff': patch
'@modern-js/bff-core': patch
'@modern-js/server': patch
'@modern-js/runtime': patch
---

Refresh the dependency cohort for one UltraModern release, including Effect 4 stable,
Node 26.10, pnpm 12, Changesets 3, and current compiler, testing and runtime libraries.
Regenerate bundled utilities and declarations with native CJS/ESM exports, discover
built API handlers under ignored output directories, and use native directory watching.
Generated applications use the same runtime and tooling versions as the framework.
