---
name: Port native snapshot ownership APIs to current Octane
overview: Supply the missing runtime and router contracts needed by cross-worker native hydration without restoring obsolete fork history.
todos:
  - id: modernjs-dnpv3.58.11.5
    content: Implement and qualify current native external and router snapshot APIs
    status: pending
isProject: false
---

# Port native snapshot ownership APIs to current Octane

## Execution notes

Own the Octane fork source for external snapshots, router render profiles and the corresponding native tests, public exports and changeset. Inspect current APIs first. The accepted runtime0.13.8/router0.2.10/compiler0.2.4 archives lack the imports required by preserved Modern router-external-snapshot.ts and worker-federation.ts. Historical code from PR2 and merged PR4 at 52c14da5, merged into the old ultramodern/signal-owner-0.7.1 branch rather than current main, is an input for a selective port, not an accepted current patch. Known authored entrypoints include packages/octane/src/server/external-snapshot-preparation.ts and the runtime.server.ts public wrapper, with hydration/external-snapshot and prepared-external-snapshot tests. Exact Git inspection confirms the named imports exist there and are absent from d5988dd93614 current main. Locate the router API by symbol on that historical ref before selecting its files.

Define a versioned serializable contract and test the native capture/restore/render/dispose lifecycle. Preserve request ownership, suspended streaming, host parent context, independent remote signal/ID namespaces, router match and i18n state. Validate identifiers, unsupported values, context/profile identity and snapshot version before executing remote application code. Bound resources and reject invalid or stale snapshots. Support multiple remotes and nested host-to-A-to-B snapshots without scope collision. Prove exactly-once disposal on success, stream error, cancellation, client disconnect, rejected identity and nested partial failure.

Keep the canonical native router/action invalidation and fixed listener record changes already merged through PR5/6. The old full feature merge had 146 conflicts; do not take it wholesale. One named Octane source owner performs both snapshot and signal-HMR ports in order: first snapshot contracts, then the dev-refresh native delta. That owner serializes runtime.ts, runtime.server.ts, signals/engine.ts and compiler changes and proves both behaviors after the second port. Dev-refresh owns its tests and semantic requirements but never writes the same native files concurrently. Record PR1 devalue history as a disposition; current Modern resolution already has5.9.3, so do not recreate that older fix without a current failing consumer. Produce normal local packs of the current authored source for Worker implementation, including public client/server declarations, browser types without Node globals and native TypeScript strict acceptance. Include actual CJS/ESM/runtime imports, no TS-extension dependencies and no workspace source aliases.

## Success criteria

Reproduce missing native contracts against the accepted baseline, then pass focused native ownership, router, cancellation and snapshot tests against ordinary packed output. Mutate ownership/disposal/admission logic to prove the critical assertions detect actual defects. Record exact source and pack metadata for downstream work. A reviewed fork PR and optional upstream PR contain only owning source changes; upstream merge timing never blocks use of a qualified fork release. No publication is required at this lane's completion; cohort owns accepted-main publication.

## Constraints

Read `README.md` in this plan directory before execution. Beads is authoritative; update only the named task and its actual completion evidence. This plan's pending todo means its new completion pass has not started, regardless of historical parent issue status. Preserve snapshot ca61247 and all other sessions' work. Do not add app shims, manual navigation handlers, suppressed checks, generated-output edits or weaker acceptance assertions. New Modern behavior belongs in fork-owned packages; upstream-owned non-shrink changes require reviewed source and the same-PR divergence ledger and boundary gate. Never edit installed dependencies to stand in for authored source.

## Operator guidance

Work only in the assigned named branch and file ownership. Read current checks/reviews once, deduplicate active validation, then build the next consumer. Use normal hooks, focused checks and exact artifacts. A failed real consumer keeps this task open with a concrete next action. Register operation-owned outputs, use the external pnpm store and clone-or-copy, and clean only this operation's authorized resources in finally/signal paths. Do not delete other sessions' dependencies.
