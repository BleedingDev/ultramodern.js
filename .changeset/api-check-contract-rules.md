---
'@modern-js/code-tools': minor
---

`modern-api-check --rules <module>` runs consumer source rules once per workspace source file. Each rule receives the file's parsed module and a shared module graph. `graph.resolve` follows imports and re-exports across workspace packages to an unmutated `const` or an external package binding, with the full chain. `graph.evaluate` and `graph.reachable` follow any binding kind, destructuring, member writes, reassignments and function returns. The `sourceRules` option replaces the per-contract `contractRules` option, and `createModuleGraph()` no longer takes a root file (use `graph.module(file)`). The runner function `runMicroVerticalApiCheckCli` now returns a Promise.
