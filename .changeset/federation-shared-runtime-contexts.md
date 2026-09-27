---
'@modern-js/runtime': patch
'@modern-js/plugin-i18n': patch
'@modern-js/runtime-extensions': minor
'@modern-js/bff-effect': patch
'@modern-js/plugin-bff-extensions': patch
'@modern-js/ultramodern-app-tools': patch
'@modern-js/backend-federation-contracts': minor
'@modern-js/server-runtime-extensions': patch
'@modern-js/app-tools-extensions': patch
'@modern-js/ultramodern-create': patch
---

Share framework contexts through Module Federation instead of `globalThis` registries. The UltraModern preset now shares every exported `@modern-js/runtime/*`, `@modern-js/plugin-i18n/runtime/*` and `@modern-js/bff-effect/*` subpath as a singleton at the installed version (subpaths the app aliases to its own generated modules, such as `/registry`, stay private), and each runtime subpath imports its React contexts through `@modern-js/runtime/context` or the new `@modern-js/plugin-i18n/runtime/contexts`. Every `@modern-js/bff-effect` entry reaches the Effect request storage through the new `@modern-js/bff-effect/context` export. A federation build that exposes modules fails when it bundles a private copy of those contexts.

The runtime, i18n and Effect BFF contexts are module-scoped again, so a dev repack gets fresh ones. `@modern-js/runtime-extensions/react-context` is removed. The Effect BFF lambda bundle keeps `@modern-js/bff-effect` and `@modern-js/plugin-bff` external, and Node loads one ESM copy of `@modern-js/bff-effect` for both `import` and `require`. Backend federation remote entries keep `@modern-js/bff-effect/context` external, and the Node evaluator supplies the host's instance, so remote endpoints read the context the host dispatcher enters.
