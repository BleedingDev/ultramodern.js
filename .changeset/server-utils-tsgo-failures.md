---
'@modern-js/server-utils': patch
---

Throw when TS-Go compilation exits nonzero in caller-managed error mode so Modern builds no longer print both TS-Go failure and success for the same diagnostics.
