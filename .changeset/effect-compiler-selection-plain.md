---
'@modern-js/app-tools-extensions': patch
---

The `./internal-effect-discovery` export no longer hashes the native and Effect TS-Go compiler binaries and no longer offers `installEffectCompilerSelectionValidator`. Compiler selection still checks that both binaries exist, are regular files and are not empty, and returns the same `compilerPath`.
