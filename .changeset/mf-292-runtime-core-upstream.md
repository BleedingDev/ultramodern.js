---
'@modern-js/ultramodern-create': patch
'@modern-js/app-tools-extensions': patch
'@modern-js/plugin-bff-extensions': patch
'@modern-js/server': patch
---

Move Module Federation to 2.9.2 and `@module-federation/node` to 2.7.52. Upstream 2.9.2 imports `ResourceLoadContext` in the runtime-core remote handler (module-federation/core#5114), so the runtime-core declaration patch is gone and `@module-federation/runtime`, `runtime-core`, `runtime-tools` and `webpack-bundler-runtime` resolve to upstream again instead of the `@bleedingdev/mf-*` sidecars. Generated apps pin `@module-federation/runtime@2.9.2`; the patched Module Federation sidecars move to their 2.9.2 bases, with `@bleedingdev/mf-modern-js-v3@2.9.3`.
