---
name: Integrate and publish the accepted native feature cohort
overview: Combine the independent feature branches, publish only canonical accepted native output, and select one coherent framework dependency tuple.
todos:
  - id: modernjs-dnpv3.58.16
    content: Integrate reviewed source and pin the exact accepted merged native feature cohort
    status: pending
isProject: false
---

# Integrate and publish the accepted native feature cohort

## Execution notes

The single integrator owns shared Modern package manifests, export maps, capability/profile metadata, release identity, fixtures, pnpm lockfile, common entrypoints and final shared composition wiring. This coordinator is assigned immediately after baseline and remains active while the implementation lanes run. Before this downstream cohort task is runnable, the coordinator commits serialized prerequisite manifest/export/capability/composition edits on each lane branch and produces normal local candidate packs. Lane owners can therefore run ordinary generated consumers. This task gates final convergence and accepted publication, not access to the coordinator. Lane owners hand over source changes without competing lockfile edits. Merge native snapshot and native dev-refresh changes in a declared order into current fork main through reviewed PRs. Re-run their intersecting ownership/regression tests on the combined source, including strict native source/public declarations. Keep optional upstream PRs separate; external review latency is not a fork release gate.

Require full successful canonical push-main CI at the exact merged native SHA, including CI provenance and validate publishable packages. Inspect existing workflow runs/releases before each dispatch. Use the existing ultramodern-native-source.yml accepted-artifact workflow from BleedingDev/octane main with the exact successful ci_run_id. Do not rebuild to publish, overwrite finalized assets, use old hardcoded native-artifact producers or republish the existing initial/final dependency release tags ec0a01239bed/d5988dd93614. Verify downloaded archive bytes, identities, versions and manifest integrities against the accepted CI artifact.

Select necessary authenticated router-core sidecar/patch output using the reviewed sidecar infrastructure. Record provenance for every request. Derive final immutable URLs and identity metadata from real accepted manifests, not provisional catalog guesses. Update all framework requests/profile/fixtures consistently, regenerate pnpm-lock.yaml with pnpm, and check the runtime/router/compiler/oxc/router-core/history closure actually installed. Preserve PR249's upgraded cohort and supported Babel/React Router7 integration lines. Never hand-edit the lockfile.

## Success criteria

All four feature/support lanes are integrated, reviewed and tested on one current source tree. Every native/sidecar asset is from accepted merged source and has verified immutable bytes. Framework manifests, public identity, profile and pnpm resolution agree without local file references or workspace substitutions. Source tests and intersecting strict type checks pass. Leave final framework PR unmerged until exact installed consumer acceptance is complete.

## Constraints

Read `README.md` in this plan directory before execution. Beads is authoritative; update only the named task and its actual completion evidence. This plan's pending todo means its new completion pass has not started, regardless of historical parent issue status. Preserve snapshot ca61247 and all other sessions' work. Do not add app shims, manual navigation handlers, suppressed checks, generated-output edits or weaker acceptance assertions. New Modern behavior belongs in fork-owned packages; upstream-owned non-shrink changes require reviewed source and the same-PR divergence ledger and boundary gate. Never edit installed dependencies to stand in for authored source.

## Operator guidance

Work only in the assigned named branch and file ownership. Read current checks/reviews once, deduplicate active validation, then build the next consumer. Use normal hooks, focused checks and exact artifacts. A failed real consumer keeps this task open with a concrete next action. Register operation-owned outputs, use the external pnpm store and clone-or-copy, and clean only this operation's authorized resources in finally/signal paths. Do not delete other sessions' dependencies.
