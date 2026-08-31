---
'@modern-js/ultramodern-create': patch
---

Keep generated UltraModern release identity promotable during native builds by
ignoring framework-owned TanStack router output and transient TS-Go resolution
files. The generated validator and migration tooling enforce the same narrow
rules without concealing user-owned source changes.
