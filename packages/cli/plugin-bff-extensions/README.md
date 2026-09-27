# @modern-js/plugin-bff-extensions

Fork-owned integration extensions for UltraModern.js BFFs. This package keeps
Effect server lifecycle integration, server source loading,
cross-project policy, Hono middleware, and backend federation out of the
upstream-owned `@modern-js/plugin-bff` implementation.

This package is maintained by the
[UltraModern.js fork](https://github.com/BleedingDev/ultramodern.js), not the
upstream Modern.js project.

## Entry points

- `/hono` exposes the peer-independent Hono route binder.
- `/cross-project-policy`, `/effect-server`, and `/effect-source-loader` expose Node tooling and server integration.
- `/cross-project-generation` renders the generated producer client runtime
  consumed by `@modern-js/plugin-bff`.
- `/backend-federation` exposes the portable federation runtime, while
  `/backend-federation/edge` rejects Node evaluators and non-binding remotes.
  The runtime is a real Module Federation instance: caller `plugins` see its
  lifecycle hooks, and a last integrity plugin loads each remote once per
  runtime. `http(s):` entries must be SHA-256 and length verified, `data:` and
  `file:` entries are evaluated or imported, and `binding:`, `service:` and
  `static:` entries come from `createBackendFederationLoadEntryPlugin()`. Any
  other entry fails with an error that names the remote.
- `/backend-federation/node` enables the hardened Node entry evaluator and
  shares the Effect handler factory registry with remote containers through
  their `init()` share scope.
- `/backend-federation-manifest` exposes manifest contracts and resolution,
  while
  `/backend-federation-manifest/node` enables its hardened Node evaluator.
  `loadBackendFederatedEffectApiFromManifest` enforces one shared
  manifest-plus-entry load deadline (default 10s, override via `timeoutMs`,
  0 to opt out) instead of resetting a fresh timeout per network hop. The
  load settles on that shared deadline/abort even when a caller-pinned
  entry provider plugin, its `init`/`get`, or a custom runtime's `loadRemote`
  never settles; it cannot stop that uncooperative work from still running,
  only stop waiting on it.

Effect and its OpenTelemetry integration are exact-cohort optional peers. A
Hono-only consumer can import `/hono` without installing Effect.

There is deliberately no adapter registry or re-export-only compatibility layer.

Effect server tooling derives operation-contract metadata without generating
client code. Import shared `HttpApi` contracts in clients and use native
`HttpApiClient.make`; the former `/client-generator` entry point is removed.
