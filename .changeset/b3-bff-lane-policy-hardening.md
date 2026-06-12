---
'@modern-js/bff-core': patch
'@modern-js/create-request': patch
'@modern-js/plugin-bff': patch
---

BFF cross-project contract hardening and Upload client restoration.

- The cross-project policy is now actually enforced in the hono and effect
  server lanes (it was previously evaluated only by the removed express/koa
  adapters, leaving the generated SDK's force-enabled policy a silent no-op).
  The effect lane enforces it at the request seam, so batched data-platform
  items cannot bypass it. Only `defineEffectBff(...)` factories (branded via
  `Symbol.for('modernjs.effect.validatorAware')`) are trusted to run that
  seam internally; hand-written `createHandler` exports now fall back to
  adapter-middleware enforcement (with a warning, since batch POSTs carry no
  per-operation contract and will be denied) instead of being silently
  unenforced.
- Operation contract hashes are computed per operation and cover the actual
  zod input schemas: changing a schema rotates exactly that operation's hash,
  while reordering routes or adding unrelated endpoints no longer invalidates
  sibling contracts. `operationVersion` is derived from the producer package
  semver major on both the generator and server sides instead of being
  hardcoded to 1.
- `evaluateCrossProjectPolicy` accepts an optional `verifyProducerIdentity`
  hook that binds the producer namespace to a verified identity channel;
  namespace allowlists are checked against the verified value and spoofed
  envelopes are rejected with `producer_identity_mismatch`. Without the hook
  the (documented) client-asserted semantics are unchanged.
- `generateClient` emits `createUploader(...)` for Upload operators again
  (regression against upstream), including requestId/operation context for
  cross-project SDKs, and `createUploader` now attaches the envelope and
  operation-context headers required by policy-enabled producers.
- `defineEffectBff(...).client` is a lazily-throwing placeholder with an
  actionable error outside the `@api/effect/*` transformed import instead of
  a typed `undefined`.
- Generated effect clients import their runtime from the new
  `@modern-js/plugin-bff/effect-client-runtime` module instead of inlining
  ~330 lines of untyped JS, and generated declarations preserve the
  group/endpoint structure of the typed client.
