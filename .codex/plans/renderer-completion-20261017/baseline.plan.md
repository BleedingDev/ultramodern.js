---
name: Reconcile preserved renderer work with the merged dependency release
overview: Establish the merged dependency cohort and an explicit disposition for every preserved source path before new implementation starts.
todos:
  - id: modernjs-dnpv3.58.14
    content: Verify the PR249 merge and prepare current-baseline feature branches
    status: completed
isProject: false
---

# Reconcile preserved renderer work with the merged dependency release

## Execution notes

The input is the pushed WIP commit ca61247ac2c09bc9bd1982556f15ee01b6f0e81b on wip/renderer-federation-navigation-20261017. The original 160 source/test/config paths plus the Beads tracking file, 161 changed paths in total, are real unfinished implementation, separate from the already published renderer baseline. PR249 merged as e61746843a39ab6de0af397c6f58f7bae72342dd after every exact-head job passed; GitHub merge state and fork main ancestry are verified. The merge gate is complete. The user authorized merging PR249 after every exact-head job passes. Keep that existing dependency release task modernjs-2uw9v alive and deduplicate its publication work.

Fetch fork refs. Create new CoW worktrees/branches from the actual merged fork baseline. Do not merge the old research branch's entire divergent history. The WIP commit is not the branch's only historical divergence. Audit the remaining branch-only commits by content and give every useful unmatched behavior a disposition too; do not claim those older commits are already carried solely from patch-equivalence counts. Compare the snapshot tree to the baseline and record each original path as already carried, required extraction with owner, superseded with evidence, or independent follow-up issue. Preserve all useful behavior through extraction or a named follow-up; no silent dropping. Check the historical Octane snapshot implementation from fork PR4, which is MERGED at 52c14da5, against the current native main. A historical merge is not proof those APIs exist in the currently accepted cohort.

Own the branch allocation and source-path disposition only. Assign native snapshot source and dev native refresh to separate branches with an explicit merge order, since both may touch runtime/server ownership. Modern dev refresh owns federation-runtime and Node publisher; Worker owns worker-federation and Worker publication; navigation owns router bindings and router-core patches; tooling owns generator/tracer changes. A single integrator owns common manifests, profile, lockfile, release identity and shared entrypoints. Lane owners propose required edits there and hand them to the integrator. This coordinator works during each lane, commits minimum prerequisite wiring on that lane branch and does not wait for the downstream cohort completion task. Local-pack consumers can therefore run before final native publication. Each ownership handoff names the path, target branch and commit, and the integrator replays shared changes once during convergence.

Reconcile existing child modernjs-dnpv3.58.11.3 as part of baseline: inspect the exact signed @bleedingdev/mf-sdk@2.9.2 registry artifact, accepted publication provenance, installed cancellation/retry/cache consumer and current alias/lock. If its original prerequisite is already satisfied, close that issue with the exact evidence. Otherwise give the missing prerequisite an explicit owner/dependency and keep the parent feature issue open. An npm version existing by itself is insufficient evidence.

The known contested set includes Octane client/server/entry/federation files; renderer-core federation.ts and server/worker.ts; renderer-solid federation.tsx; app-tools-extensions Cloudflare native-renderer/worker-manifest and cloudflare-entry templates; shared native-composition config/native-module-federation/native-entry/workspace-preset; tests/utils/modernTestUtils.js; react-rsc-worker-proof helpers; and publish workflow.mjs. Assign every exact changed path before extraction. Worker owns Worker semantics in these paths, dev-refresh owns dev publisher/refresh semantics, and tooling owns reusable helper/lifecycle behavior. The integrator applies their authored patches serially and reviews intersections, rather than inventing all feature logic. Worker authors capability/template behavior, tooling reviews generator mechanics, and the integrator commits the final shared metadata. Same-PR FORK-DIVERGENCE.md rows travel with the lane PR that changes upstream-owned code; they do not wait for final cohort integration.

## Success criteria

PR249 merged SHA and accepted native release tuple are recorded. Every preserved source path has an evidence-backed disposition. Every required feature has one owner and tests. Current native baseline is d5988dd93614 unless a newer qualified merged source deliberately replaces it. No unfinished feature is advertised as production ready. All downstream branches start from current source, with exact merge sequencing for overlapping native files.

## Constraints

Read `README.md` in this plan directory before execution. Beads is authoritative; update only the named task and its actual completion evidence. This plan's pending todo means its new completion pass has not started, regardless of historical parent issue status. Preserve snapshot ca61247 and all other sessions' work. Do not add app shims, manual navigation handlers, suppressed checks, generated-output edits or weaker acceptance assertions. New Modern behavior belongs in fork-owned packages; upstream-owned non-shrink changes require reviewed source and the same-PR divergence ledger and boundary gate. Never edit installed dependencies to stand in for authored source.

## Operator guidance

Work only in the assigned named branch and file ownership. Read current checks/reviews once, deduplicate active validation, then build the next consumer. Use normal hooks, focused checks and exact artifacts. A failed real consumer keeps this task open with a concrete next action. Register operation-owned outputs, use the external pnpm store and clone-or-copy, and clean only this operation's authorized resources in finally/signal paths. Do not delete other sessions' dependencies.
