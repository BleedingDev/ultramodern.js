---
name: Dependency refresh Effect stable
overview: Move the existing Effect v4 release-candidate integration to 4.0.0 and remove the repaired router patch and corrected sidecar after behavior proofs.
todos:
  - id: move-effect-import-contract
    content: Update Effect runtime pins and every old unstable import, re-export and generated source contract to the verified 4.0.0 exports.
    status: pending
  - id: verify-effect-runtime-semantics
    content: Repair RC-to-stable schema, HTTP, RPC, cancellation and cleanup differences and verify Node and Worker behavior with focused regressions.
    status: pending
  - id: retire-effect-correction
    content: Prove upstream Worker code-generation safety and deliver exact patch and sidecar removal proposals to the supply and generator owners.
    status: pending
isProject: false
---

# Dependency refresh Effect stable

## Execution Notes

Beads `modernjs-h8xqq.3`. Depends on baseline and tooling. Own `packages/server/bff-effect/**`, Effect-specific BFF CLI extension code/tests, and Effect integration source/tests. Submit manifest and producer changes to the coordinator; generator source under ultramodern-create belongs to the generator lane. Target exact runtime Effect and OpenTelemetry 4.0.0. Diagnostics `@effect/tsgo` remains independently versioned at the frozen 0.47.2 target.

Replace `effect/unstable/http`, `effect/unstable/httpapi`, `effect/unstable/rpc` and other used old paths using the tarball's export map. Use `effect/http`, `effect/http-api`, `effect/rpc` for these areas. Inspect subpath names rather than assuming that dropping one path segment always works. Include public re-exports and generated source contracts in the handoff. Remove obsolete aliases rather than keeping compatibility code.

The stable artifact already uses assignment for FindMyWay params. Supply removal of the old patch and corrected Effect sidecar to the build/supply owner for `patch-inventory.ts`, `sidecars.json` and hashes. Generator integration must remove the corrected alias in policy and publication projections. Keep one Effect identity across runtime, optional peers, shared contracts and MF singletons.

## Constraints

No app-level wrappers or broad type casts to suppress incompatible APIs. Preserve precise brands, finite supported-value unions and negative compile checks. Do not introduce standalone `@effect/platform` or `@effect/rpc` v3 packages. Retire the patch only after upstream's actual behavior is tested. Canonical correction files are changed once by the supply owner; this lane provides reviewed exact removals.

## Operator Guidance

Use TraceDecay diagnostics before compiler validation and narrow impact/test mapping for touched runtime symbols. Build and run relevant BFF Effect and CLI extension tests. Cover HTTPAPI encode/decode and error envelopes, RPC framing and interruption, request scope/finalizer failures, stream/SSE handling where used, cross-project contracts and federation loading. Existing schema brands are concrete; test any representation behavior that actually depends on brands. Check the final bundle for string code generation and execute it in a Worker runtime. Package declarations and browser/node exports must consume ordinary Effect 4.0.0 successfully.
