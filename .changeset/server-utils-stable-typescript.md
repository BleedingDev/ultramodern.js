---
'@modern-js/server-utils': patch
'@modern-js/builder': patch
---

Compile server and BFF source and run the builder's default native type checker with the exact stable TypeScript 7.0.2 production dependency. Resolve the compiler through its canonical published package and declared launcher. Remove nightly compiler fallback paths and reject incompatible application compiler versions before emission or checking.
