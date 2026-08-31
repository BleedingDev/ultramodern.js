---
'@modern-js/ultramodern-create': patch
---

Add the generated pnpm trust-policy exclusion required for the latest Effect
OpenTelemetry beta publish metadata, and make `migrate-strict-effect` repair
existing generated workspace Effect overrides, pnpm policy, and framework-owned
toolchain pins before refreshing the lockfile.
