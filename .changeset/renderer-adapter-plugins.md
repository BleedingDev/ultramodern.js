---
'@modern-js/renderer-core': patch
'@modern-js/renderer-solid': patch
'@modern-js/renderer-octane': patch
'@modern-js/ultramodern-app-tools': patch
'@modern-js/ultramodern-create': patch
---

Renderers now plug in through a build-side adapter. `@modern-js/renderer-core/adapter` defines the `RendererAdapter` interface, and `@modern-js/renderer-solid/plugin` and `@modern-js/renderer-octane/plugin` export each renderer's adapter: its profile, runtime entry modules, Module Federation singletons, worker support, compiler, artifact validation and create templates. The Solid and Octane compilers, loaders and app templates moved out of `@modern-js/ultramodern-app-tools` and `@modern-js/ultramodern-create` into those packages, together with their build dependencies (`@babel/core` and `@jridgewell/remapping` for Solid; `@solidjs/compiler`, `@octanejs/rspack-plugin` and `@rsbuild/core` as optional peers). `@modern-js/ultramodern-app-tools` loads only the selected renderer's adapter; the packages and source extensions each renderer owns stay in its renderer registration, so route-source ownership checks never load or require an unselected renderer package. `@modern-js/ultramodern-create` reads the same ownership, and `@modern-js/ultramodern-create` now depends on both renderer packages to scaffold them.

`renderer-build.json` now records the adapter's worker support as `worker: { nativeDocuments, rsc }`.
