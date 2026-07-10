---
'@modern-js/create': minor
---

Add strict UltraModern config schema-version dispatch. Unknown `schemaVersion` values and unknown app `kind` values now fail with a typed `UnsupportedUltramodernConfigError` before any file is written, instead of being silently normalized (unknown kinds were previously coerced to `shell`). Supported v1 configs normalize exactly as before.
