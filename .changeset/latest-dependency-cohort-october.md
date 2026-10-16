---
'@modern-js/ultramodern-create': minor
'@modern-js/renderer-solid': minor
'@modern-js/renderer-octane': patch
'@modern-js/runtime': minor
'@modern-js/app-tools': patch
'@modern-js/builder': patch
'@modern-js/utils': patch
'@modern-js/bff-effect': patch
---

Refresh the framework, renderer, generated-workspace and build dependencies together, including React 19.3.1, Solid 2 rc.15, Effect 4.0.5 and the current Rstack cohort. Use Node 26.12.0 and pnpm 12.11.2 for development and generated workspaces. The legacy React Router runtime uses the supported React Router 7 release; generated UltraModern apps continue to use TanStack Router.

Keep the maintained Octane distribution while the newest upstream runtime and router fail generated-app strict TypeScript checks. Babel 7 and React Router 7 remain on their supported release lines for SVGR and Module Federation.
