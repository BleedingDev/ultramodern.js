---
'@modern-js/ultramodern-create': patch
'@modern-js/ultramodern-app-tools': patch
---

The Module Federation sidecars now carry exactly the built diffs of open module-federation/core PRs on top of 2.9.2: #5130 (bridge-react), #5131, #5159 and the rootDir hunk of #4947 (dts-plugin), #5132 (manifest, rspack), #5152 (runtime-core `resetFederationRuntime`, the modern-js-v3 server `onReset` handler and node `performReload`), and #5133, #4851, #5155, #5156 and #5158 (modern-js-v3). The UltraModern-only hunks are gone from the modern-js-v3 patch: the framework preset already shares the React JSX runtimes and sets `injectLink: false`, and it now registers the `@modern-js/federation-runtime` manifest-recovery runtime plugin on the server federation plugin itself, resolved from the app directory. The runtime chain publishes again as `@bleedingdev/mf-runtime-core`, `mf-runtime`, `mf-runtime-tools` and `mf-webpack-bundler-runtime@2.9.2`, and generated apps pin `@module-federation/runtime` to `npm:@bleedingdev/mf-runtime@2.9.2`.
