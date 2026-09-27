---
'@modern-js/bff-core': patch
---

Remove the unused `registerPaths` and `getRelativeRuntimePath` exports. `registerPaths` replaced `Module._resolveFilename` for the whole process and had no caller; alias resolution belongs to the bundler and the app-tools ESM loader hooks. `tsconfig-paths` is no longer a peer dependency.
