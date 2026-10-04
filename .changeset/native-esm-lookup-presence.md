---
"@modern-js/ultramodern-app-tools": patch
---

Resolve native ESM config imports from their declared dependency cohort when the package is available only through CommonJS global lookup paths. Preserve errors from broken packages installed in the original import lookup paths.
