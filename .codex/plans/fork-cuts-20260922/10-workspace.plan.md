---
name: workspace-model-transactions
overview: "Project current workspace state once and reuse the hardened publisher for both preview and apply."
todos:
  - id: workspace-model-transactions-model
    content: "Consolidate workspace normalization and ownership-aware projections for create/add-vertical/add-shell, preserving current consumer fields and distinct additional-shell representation."
    status: completed
  - id: workspace-model-transactions-operations
    content: "Replace per-command topology, port, overlay and generated-artifact reconstruction with the common projection and explicit operation intent."
    status: completed
  - id: workspace-model-transactions-preview
    content: "Expose a prepared transaction for preview or publication; remove preview double-copy/staging and handwritten JSON mutation reconstruction after concurrency and failure parity."
    status: completed
isProject: false
---

# workspace-model-transactions

## Execution Notes

Own ultramodern-create/src/ultramodern-workspace/{write-workspace.ts,add-shell.ts,add-vertical/*,workspace-validation-contract.ts,workspace-artifact-ownership.ts} and ultramodern-tooling/config/normalize.ts. Exclude remote-refs.ts, shared-patches.ts, demo-components.ts and validator/CLI context files owned by sibling lanes. The obsolete migration engine is already deleted; do not restore it. Reuse the existing hardened transaction publisher, with distinct fresh-workspace and update publication policies.

Audit: [current fork evidence](../../../docs/audits/fork-simplification-20260922.md). Final audited fork `ba2f373ad9587642062efc65c763276a68aee909`; fixed vanilla ownership base `eded841256a7cffdaa622e3889fc83407debd3e4`. Beads `modernjs-wuutt.2` under `modernjs-wuutt` is authoritative; keep this execution projection aligned. Source implementation and compiled CLI preview acceptance are complete.

## Constraints

Preserve current features, consumer ownership, database migrations and platform interoperability. Latest AGENTS.md requires direct removal of obsolete APIs, aliases and framework migration compatibility because there is no external adoption requirement. Do not restore already-retired code. New subsystems stay fork-owned; native non-shrink edits need same-PR ledger evidence. No app workaround, source import across vertical ownership, hand-edited generated output/lockfile, weakened gate or arbitrary deletion quota. Reuse existing owners; relocation is not a cut. New test deletion proposals require explicit selection, and approved prior deletions must not be silently reversed.

## Operator Guidance

Preserve preimage conflicts before/during publication, owned directory identity, internal/external link policy, file modes, Windows, partial failure/recovery bytes, staged validation, current headless/UI/full-stack profiles, consumer URLs/ports and empty composition. Failure rollback is not crash atomicity. Retained tests: vertical-dry-run, add-shell, add-vertical-transaction, workspace-artifact-derivation, workspace-input-normalization and workspace-artifact-ownership. Report removed decision owners and net authored lines.

Depends on preservation-baseline and blocks integrated-feature-parity. Siblings may run in parallel within the named ownership boundaries. Native Codex workers are not alone in the codebase and must preserve other owners edits. Shared file changes go through the root integrator.

Use the exact selection/edges in docs/audits/fork-simplification-20260922-handoff.md. Validate before plan-backed launches. Run relevant current behavior checks, report limitations and include concrete removed decision owners plus net authored-code change in the PR.

## Implementation evidence

Both update commands now use `normalizeWorkspaceInputs` and one normalized operation-settings resolver; three disk-reloading helper APIs were removed. Additional shells remain separate from primary topology. The normalization policy records the existing distinction explicitly: add-shell honors compact primary composition, while add-vertical honors reference topology. Explicit empty references remain empty. Shared ownership candidates and development-port projection replace repeated command-local script, configuration and Zerops reconstruction, preserving operator-reserved overlay ports.

Shell and vertical preview now use the publisher's single staging/capture path in preview mode. Preview never publishes or recovers into the live tree. JSON mutation descriptions derive from the prepared bytes; retained tests replay them against the preimage and compare actual publication. Consumer-ownership notices go to stderr so CLI JSON remains parseable. Fresh-workspace publication and update recovery retain their separate hardened policies.

Authored source: 4,523 to 4,236 lines across the eleven changed/new source files (287 net lines removed). No retained tests were removed. Focused validation covers 33 cases across seven retained files, all passing after the coordinated rebuild and narrowed-API test update. The final five-case CLI/artifact rerun passed, including parseable preview JSON with authored configuration. Ten transaction cases cover interruption recovery, concurrent consumer edits, owned-directory identity, async preview and modes. Biome and diff whitespace checks pass. Integrated packed/Tractor acceptance belongs to the root acceptance wave.

A further candidate remains subject to explicit test selection: the embedded-contract literal AST recognizer in workspace artifact ownership now has no production caller, but its retained synthetic test exercises that obsolete capability. No recognizer or test was removed without selection.
