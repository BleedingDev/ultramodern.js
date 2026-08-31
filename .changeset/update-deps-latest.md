---
'@modern-js/builder': patch
'@modern-js/plugin-bff': patch
'@modern-js/plugin-styled-components': patch
'@modern-js/runtime': patch
'@modern-js/bff-core': patch
'@modern-js/server-core': patch
'@modern-js/plugin-polyfill': patch
'@modern-js/server': patch
'@modern-js/app-tools': patch
'@modern-js/code-tools': patch
'@modern-js/plugin': patch
'@modern-js/runtime-utils': patch
'@modern-js/utils': patch
'@modern-js/image': patch
'@modern-js/ultramodern-create': patch
---

chore: update dependencies to latest

- @rsbuild/core 2.0.11, @rslib/core 0.22.0, @swc/core 1.15.41, sharp 0.35.0, @typescript/native-preview 7.0.0-dev.20260610.1, @effect/tsgo 0.14.3 and other patch/minor refreshes across the workspace
- plugin-styled-components: widen styled-components peer range to `^5.3.1 || ^6.0.0`
- utils: add `types` conditions to the compiled subpath exports so bundler-mode resolution finds the vendored declarations
- tsconfig base: replace removed `moduleResolution: node10` with `module: preserve` + `moduleResolution: bundler` for TypeScript 7
- create: generated workspaces now pin wrangler 4.99.0, @effect/tsgo 0.14.3, oxlint 1.69.0, oxfmt 0.54.0, ultracite 7.8.3, @typescript/native-preview 7.0.0-dev.20260610.1
