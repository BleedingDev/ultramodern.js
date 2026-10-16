---
name: Complete native Worker federation
overview: Finish the preserved transport and compiler publication code and prove actual worker-to-worker rendering and retained browser hydration.
todos:
  - id: modernjs-dnpv3.58.11.1.1
    content: Pass source Worker federation and generated separate workerd/browser consumers
    status: pending
isProject: false
---

# Complete native Worker federation

## Execution notes

Own renderer-core/src/worker-federation, renderer-octane/src/worker-federation*, router/i18n external snapshot bindings, ultramodern-app-tools native-worker publication/policy/config modules, and tests/ultramodern-renderers/octane-federation-workers. Coordinate shared entrypoints and manifests through cohort integrator. Start after the native-snapshots lane provides normal packs. No worker transport may execute Node fs/vm/eval container loaders or use React hydration markers.

Run the existing native-federation-workers.mjs producer and original proof against current authored source before classifying failures. Verify separate workerd host and remote processes/service bindings, two remotes and nested host-to-A-to-B requests. Prove exact SSR node retention, remote CSS and order, native interaction state, host router/i18n/context identity, dynamic props, isolated remote namespaces and host request cancellation. Bound all transport/body/status deadlines and handle abort-before-read, cancellation during stream, hung and malformed responses, partial streams, concurrent requests, rejection and later recovery. Reject foreign renderer, cohort/digest, origin and profile before remote application execution. Validate publication advertises only admitted exact entry/chunk assets and removes stale revisions.

The ordinary prebuilt source proof explicitly does not cover public generation. Generate a fresh supported native Worker workspace through public tooling, build and deploy its actual artifacts to workerd, and run the unchanged browser/transport checks using its real topology and routes. Enable the native Worker capability in the unpublished reviewed candidate so the normal generator can exercise it. Update the adapter plugin capability, generation-profile projection and normal validation consistently; do not add a special proof bypass. Merge and public publication remain blocked until that genuinely generated case passes. Keep prebuilt and generated acceptance distinct. Support Route exposes where the native compiler's ordinary component contract allows them.

## Success criteria

Real source workerd-to-workerd plus browser proof passes without aliases or app patches, including nested ownership, transport rejection and cleanup. A fresh consumer generated through the public API, installed from normal candidate framework/native packs, also passes; a test harness file or a Node-only proof is insufficient. Candidate local packs are explicitly allowed for implementation and never labeled as released bytes. Tests and authored implementation are committed in a reviewed feature branch. Final exact released package acceptance is repeated by acceptance after cohort pins are final.

## Constraints

Read `README.md` in this plan directory before execution. Beads is authoritative; update only the named task and its actual completion evidence. This plan's pending todo means its new completion pass has not started, regardless of historical parent issue status. Preserve snapshot ca61247 and all other sessions' work. Do not add app shims, manual navigation handlers, suppressed checks, generated-output edits or weaker acceptance assertions. New Modern behavior belongs in fork-owned packages; upstream-owned non-shrink changes require reviewed source and the same-PR divergence ledger and boundary gate. Never edit installed dependencies to stand in for authored source.

## Operator guidance

Work only in the assigned named branch and file ownership. Read current checks/reviews once, deduplicate active validation, then build the next consumer. Use normal hooks, focused checks and exact artifacts. A failed real consumer keeps this task open with a concrete next action. Register operation-owned outputs, use the external pnpm store and clone-or-copy, and clean only this operation's authorized resources in finally/signal paths. Do not delete other sessions' dependencies.
