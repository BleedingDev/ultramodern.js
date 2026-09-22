---
name: workspace-model-transactions
overview: "Project current workspace state once and reuse the hardened publisher for both preview and apply."
todos:
  - id: workspace-model-transactions-model
    content: "Consolidate workspace normalization and ownership-aware projections for create/add-vertical/add-shell, preserving current consumer fields and distinct additional-shell representation."
    status: pending
  - id: workspace-model-transactions-operations
    content: "Replace per-command topology, port, overlay and generated-artifact reconstruction with the common projection and explicit operation intent."
    status: pending
  - id: workspace-model-transactions-preview
    content: "Expose a prepared transaction for preview or publication; remove preview double-copy/staging and handwritten JSON mutation reconstruction after concurrency and failure parity."
    status: pending
isProject: false
---

# workspace-model-transactions

## Execution Notes

Own ultramodern-create/src/ultramodern-workspace/{write-workspace.ts,add-shell.ts,add-vertical/*,workspace-validation-contract.ts,workspace-artifact-ownership.ts} and ultramodern-tooling/config/normalize.ts. Exclude remote-refs.ts, shared-patches.ts, demo-components.ts and validator/CLI context files owned by sibling lanes. The obsolete migration engine is already deleted; do not restore it. Reuse the existing hardened transaction publisher, with distinct fresh-workspace and update publication policies.

Audit: [current fork evidence](../../../docs/audits/fork-simplification-20260922.md). Final audited fork `ba2f373ad9587642062efc65c763276a68aee909`; fixed vanilla ownership base `eded841256a7cffdaa622e3889fc83407debd3e4`. Beads `modernjs-wuutt.2` under `modernjs-wuutt` is authoritative; keep this execution projection aligned. All implementation is pending.

## Constraints

Preserve current features, consumer ownership, database migrations and platform interoperability. Latest AGENTS.md requires direct removal of obsolete APIs, aliases and framework migration compatibility because there is no external adoption requirement. Do not restore already-retired code. New subsystems stay fork-owned; native non-shrink edits need same-PR ledger evidence. No app workaround, source import across vertical ownership, hand-edited generated output/lockfile, weakened gate or arbitrary deletion quota. Reuse existing owners; relocation is not a cut. New test deletion proposals require explicit selection, and approved prior deletions must not be silently reversed.

## Operator Guidance

Preserve preimage conflicts before/during publication, owned directory identity, internal/external link policy, file modes, Windows, partial failure/recovery bytes, staged validation, current headless/UI/full-stack profiles, consumer URLs/ports and empty composition. Failure rollback is not crash atomicity. Retained tests: vertical-dry-run, add-shell, add-vertical-transaction, workspace-artifact-derivation, workspace-input-normalization and workspace-artifact-ownership. Report removed decision owners and net authored lines.

Depends on preservation-baseline and blocks integrated-feature-parity. Siblings may run in parallel within the named ownership boundaries. Native Codex workers are not alone in the codebase and must preserve other owners edits. Shared file changes go through the root integrator.

Use the exact selection/edges in docs/audits/fork-simplification-20260922-handoff.md. Validate before plan-backed launches. Run relevant current behavior checks, report limitations and include concrete removed decision owners plus net authored-code change in the PR.
