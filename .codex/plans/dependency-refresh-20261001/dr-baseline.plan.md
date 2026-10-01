---
name: Dependency refresh baseline
overview: Freeze the dependency target matrix, ownership routes and verification baseline for one coordinated UltraModern release.
todos:
  - id: freeze-target-matrix
    content: Refresh registry evidence and freeze a target or reasoned exception for every active dependency, peer, alias, override and recipe.
    status: pending
  - id: record-ownership-routes
    content: Classify expected package edits by fork ownership and record the reviewed route for each upstream-owned change.
    status: pending
  - id: capture-acceptance-baseline
    content: Capture current build, runtime, consumer install and bundle baselines with reproducible commands and failure provenance.
    status: pending
isProject: false
---

# Dependency refresh baseline

## Execution Notes

Beads `modernjs-h8xqq.1`, epic `modernjs-h8xqq`. Read [research](../../../docs/research/dependency-refresh-20261001/research.md) and its complete declaration and lockfile inventories. Research source is `4d606d0203fe4c67585cbff5d3f72a0e80de402f`; reconcile intervening work before execution. Read `CONTEXT.md`, present ADRs and `docs/agents/domain.md` if present. This work advances the existing platform baseline and release stream.

Freeze current, target, supported channel, dependency class, consumers, peer satisfaction, patch/alias identity, owner, behavioral tests and release-age eligibility. Include manifest optional peers, generator constants/policy, source template literals, sidecar manifest rewrites, prebundled utilities, workspace overrides and resolved transitive security findings. Map local workspace identities and synthetic/negative fixtures explicitly; do not substitute npm upstream versions. Check exact package metadata when highest published and latest differ. Inspect full tagged changelogs for active major and pre-1.0 minor updates.

## Constraints

One public release, with internal commits permitted. No dependency implementation before targets and unresolved choices are reviewed. No broad exceptions, automatic major overrides or synthetic app fixes. Preserve the audited base and canonical divergence scope. Do not mix unrelated changes or existing plan work into this epic. Track progress in Beads; synchronize this plan's status projection only when its work actually finishes.

## Operator Guidance

This is the graph root. All later plans depend on it through the checked graph commands in README.md. Own the matrix, exception decisions and baseline evidence; no other lane writes these records concurrently.

Record exit codes and logs for current frozen install, dependency consistency, required package build, unit/framework/builder checks, boundary/supply verification and independent generated consumer install. Distinguish baseline failures from upgrade regressions, with concrete reproduction and owner. Measure bundle bytes and consumer install duration/size using the same fixture and environment later. Audit findings already known are in the research artifact; do not use the noisy nested-worktree scan as a release criterion. Recheck whether the Tractor demo exists. Do not launch subagents during planning; later delegation requires explicit authorization and the validated graph.
