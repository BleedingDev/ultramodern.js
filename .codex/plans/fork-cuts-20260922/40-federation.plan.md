---
name: federation-contracts-transport
overview: "Delete duplicated federation acquisition and identity interpretation while making degraded fallback independent of telemetry availability."
todos:
  - id: federation-contracts-transport-transport
    content: "Share internal deadline, abort and bounded acquisition mechanics while retaining generic-resource and strict executable-entry policy adapters."
    status: completed
  - id: federation-contracts-transport-identity
    content: "Construct one internal delivery identity with compatible wire projections and share decoded compatibility constraints across manifest/expose consumers; retain independent trust-boundary verification."
    status: completed
  - id: federation-contracts-transport-telemetry
    content: "Move telemetry payload/emission into a leaf module, make remote reporting bounded and independent of fallback completion, and expose explicit observation/flush for tests."
    status: completed
  - id: federation-contracts-transport-prove
    content: "Run adversarial acquisition, identity, critical/noncritical fallback and platform-isolation contracts, then delete duplicate state machines and payload construction."
    status: completed
isProject: false
---

# federation-contracts-transport

## Execution Notes

Own server/runtime-extensions/backend-federation-security, runtime/federation-runtime/module-federation telemetry/consume modules, toolkit/backend-federation-contracts and CLI backend-federation manifest/identity decoding. Exclude general BFF generation, batch and adapter entry paths. Keep Node evaluation separate from workerd distributed fragments. Do not include conditional native drain seam or JS public-path rewrite retirement in this lane.

Audit: [current fork evidence](../../../docs/audits/fork-simplification-20260922.md). Final audited fork `ba2f373ad9587642062efc65c763276a68aee909`; fixed vanilla ownership base `eded841256a7cffdaa622e3889fc83407debd3e4`. Beads `modernjs-wuutt.8` under `modernjs-wuutt` is authoritative; keep this execution projection aligned. Implementation completed; root coordinates final package build and downstream acceptance.

## Constraints

Preserve current features, consumer ownership, database migrations and platform interoperability. Latest AGENTS.md requires direct removal of obsolete APIs, aliases and framework migration compatibility because there is no external adoption requirement. Do not restore already-retired code. New subsystems stay fork-owned; native non-shrink edits need same-PR ledger evidence. No app workaround, source import across vertical ownership, hand-edited generated output/lockfile, weakened gate or arbitrary deletion quota. Reuse existing owners; relocation is not a cut. New test deletion proposals require explicit selection, and approved prior deletions must not be silently reversed.

## Operator Guidance

Keep one inner deadline through fetch/body/SHA-256 AND the current outer total manifest/entry/container budget. Preserve 10-second default, explicit zero opt-out, noncooperative loader/init/custom runtime settlement, external abort and late rejection. Strict identity is mandatory; do not restore legacy absence tolerance. Preserve trusted byte length, verified-only execution, redirect/redaction/error behavior, independent incoming-record validation and current MF wire interoperability. Basic fallback proof is now federation-runtime/tests/module-federation/index.test.ts; add targeted stalled telemetry evidence instead of restoring deleted consume-surface tests. CSS requests reject redirects while allowing direct loopback; retain live redirect non-contact proof. Native drain/public-path rewrite retirement stays conditional.

Depends on preservation-baseline and blocks integrated-feature-parity. Siblings may run in parallel within the named ownership boundaries. Native Codex workers are not alone in the codebase and must preserve other owners edits. Shared file changes go through the root integrator.

Use the exact selection/edges in docs/audits/fork-simplification-20260922-handoff.md. Validate before plan-backed launches. Run relevant current behavior checks, report limitations and include concrete removed decision owners plus net authored-code change in the PR.

## Completion evidence

The duplicated resource/entry acquisition state machine is replaced by one bounded transport owner. Executable entries retain trusted exact-size allocation, byte-length and SHA-256 verification inside the acquisition deadline; generic resources retain their bounded chunk/text policy. Cleanup no longer awaits an uncooperative stream cancellation. Final caller cancellation is checked before evaluation, and evaluator failures preserve their original exception.

Build artifacts project one delivery identity into current wire surfaces; stamping selects only its three identity fields. Manifest/expose consumers share compatibility decoding/comparison while independently checking every received/executed boundary. Missing compatibility remains a rejection.

Telemetry lives in a dependency-leaf module, emits the already-created payload once, bounds HTTP reporting to a one-second default, and exposes per-emission observation with a delivery promise. Degraded completion never awaits reporting. Noncritical handler failure is honestly typed as potentially undefined; critical rejection retains its original cause.

Validation: 79 focused tests passed across backendFederationSecurity, backend-federation-runtime, moduleFederationCss, module-federation/index and backendFederationContractMatrix. Includes existing whole-operation 10-second/default/zero/abort/custom-loader cases, live CSS redirect non-contact and edge isolation; added stalled SHA-256/cancellation/reporting, successful browser/HTTP emission, original critical cause, noncritical handler failure and missing/drifting expose identity cases. Federation-runtime TypeScript noEmit and scoped Biome checks passed. No test deletions, package metadata changes or upstream-owned file edits.
