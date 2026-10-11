---
'@modern-js/ultramodern-app-tools': patch
'@modern-js/app-tools-extensions': patch
---

React apps now run the Module Federation DTS plugin and `@rsbuild/plugin-typed-css-modules` unwrapped, so remote type generation and consumption and `*.module.css.d.ts` output come straight from the upstream plugins. A build no longer fails with "requested API types were not acknowledged". React resolves its renderer identity once before compilation instead of compiling a private discovery pass, and dev keeps the first identity for the session. The `./react-mf-dts-implementation` export and the `generatedOutputs` option of `resolveRendererBuildIdentities` are removed.
