# @modern-js/plugin-bff-extensions

Fork-owned integration extensions for UltraModern.js BFFs. This package keeps
Effect adapter lifecycle integration, source and client generation,
cross-project policy, Hono middleware, and backend federation out of the
upstream-owned `@modern-js/plugin-bff` implementation.

This package is maintained by the
[UltraModern.js fork](https://github.com/BleedingDev/ultramodern.js), not the
upstream Modern.js project.

## Entry points

- `@modern-js/plugin-bff-extensions` and `/hono` expose the peer-independent
  Hono cross-project-policy middleware.
- `/cross-project-policy`, `/effect-adapter`, `/effect-source-loader`, and
  `/client-generator` expose Node tooling and server integration.
- `/backend-federation` exposes the portable federation runtime, while
  `/backend-federation/edge` rejects Node evaluators and non-binding remotes.
- `/backend-federation/node` enables the hardened Node entry evaluator.
- `/backend-federation-manifest` exposes manifest resolution, while
  `/backend-federation-manifest/node` enables its hardened Node evaluator.

Effect and its OpenTelemetry integration are exact-cohort optional peers. A
Hono-only consumer can import the package root or `/hono` without installing
Effect.

There is deliberately no adapter-kit or re-export-only compatibility layer.
