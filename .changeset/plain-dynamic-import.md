---
'@modern-js/utils': patch
'@modern-js/app-tools': patch
---

fix: load modules with plain `import()` and let deploy resolution errors propagate

`dynamicImport` (a `new Function` wrapper) is removed; `compatibleRequire` now falls back to `import()` for ESM graphs with top-level await, so CLI plugins no longer need a catch-all retry that masked their real errors. `resolveESMDependency` throws with the specifier, conditions and base instead of returning `undefined`.
