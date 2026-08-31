# @modern-js/bff-effect

Fork-owned Effect primitives for UltraModern.js BFF runtimes. The package
keeps the portable Effect handler, data-platform, generated-client runtime,
and edge dispatcher behind standalone package entry points rather than growing
the upstream-owned `@modern-js/plugin-bff` implementation.

This package is maintained by the
[UltraModern.js fork](https://github.com/BleedingDev/ultramodern.js), not the
upstream Modern.js project.

## Entry points

- `@modern-js/bff-effect` and `@modern-js/bff-effect/effect` expose the Node
  Effect BFF runtime and handler contracts.
- `@modern-js/bff-effect/effect-edge` exposes the edge-safe dispatcher without
  a static Node built-in import.
- `@modern-js/bff-effect/effect-client` exposes the Effect client runtime.
- `@modern-js/bff-effect/effect-client-runtime` exposes the generated-client
  runtime helpers.
- `@modern-js/bff-effect/data-platform` exposes batching, envelope, tracing,
  validation, and invalidation primitives.

Adapter lifecycle integration, Hono integration, source/client generation, and
backend federation are intentionally owned by their respective packages.
