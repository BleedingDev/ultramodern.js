---
'@modern-js/builder': patch
---

Run React Compiler only for browser (`web`) environments. `node`, worker SSR and BFF builds no longer get `jsc.transform.reactCompiler`, which aborted Rspack with a stack overflow on long fluent chains such as a BFF module composing hundreds of `.addHttpApi(...)` groups.
