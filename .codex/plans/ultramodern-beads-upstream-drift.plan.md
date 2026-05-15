---
name: Ultramodern Beads Upstream Drift Closure
overview: Close the remaining upstream-drift blocker for main-ultramodern so later RSC and live-control-plane work is validated against a clean Modern.js baseline.
todos:
  - id: ubf-drift-01
    content: Reconfirm the pushed main-ultramodern baseline, current origin/main delta, remote state, and open Beads follow-up scope before changing code.
    status: completed
  - id: ubf-drift-02
    content: Resolve modernjs-7gp by rebasing or merging main-ultramodern against origin/main and fixing certification drift conflicts in plugin-bff CLI, app-tools serverBuild, and toolkit CLI utilities.
    status: completed
  - id: ubf-drift-03
    content: Rerun SuperApp certification smoke until app-facing commands and upstreamDrift both pass cleanly, then record evidence and update modernjs-7gp.
    status: completed
isProject: true
---

# Ultramodern Beads Upstream Drift Closure

## Execution Notes

This is the critical-path root for the Beads follow-up graph after commit `8ca8d29979` on `main-ultramodern`. The last certification run proved app-facing commands but failed the upstream-drift gate because the branch no longer merged cleanly with `origin/main`.

Primary conflict evidence from `modernjs-7gp`:

- `packages/cli/plugin-bff/src/cli.ts`
- `packages/solutions/app-tools/src/plugins/serverBuild.ts`
- `packages/toolkit/utils/src/cli/index.ts`

Resolve this first so downstream TanStack RSC and live-control-plane validation does not hide old merge drift.

## Scope

Own only upstream drift closure, merge conflict fixes, and certification evidence needed to prove the branch is clean against current Modern.js `main`.

Do not implement TanStack RSC payload-router behavior or live local control-plane mode here unless a conflict fix is required to keep existing behavior compiling.

## Validation

Minimum proof for completion:

- `pnpm run validate:superapp-certification:smoke`
- clean upstream drift result inside the certification report
- clean `git status --short`

Completed on merged commit `6450cf16c2` with summary
`.modern/superapp-certification/2026-05-15T23-26-49-290Z/summary.json`.
The smoke run passed all commands and `upstreamDrift.status` was `merged`
with no conflicts.

## Graph Handoff

Use this plan set with explicit dependencies:

```bash
python /Users/satan/side/experiments/skills/plan-graph/scripts/plan_graph.py validate --glob 'ultramodern-beads-*.plan.md' --depends ultramodern-beads-upstream-drift:ultramodern-beads-tanstack-rsc-payload-router --depends ultramodern-beads-upstream-drift:ultramodern-beads-live-control-plane --depends ultramodern-beads-tanstack-rsc-payload-router:ultramodern-beads-final-readiness --depends ultramodern-beads-live-control-plane:ultramodern-beads-final-readiness
python /Users/satan/side/experiments/skills/plan-graph/scripts/plan_graph.py frontier --glob 'ultramodern-beads-*.plan.md' --depends ultramodern-beads-upstream-drift:ultramodern-beads-tanstack-rsc-payload-router --depends ultramodern-beads-upstream-drift:ultramodern-beads-live-control-plane --depends ultramodern-beads-tanstack-rsc-payload-router:ultramodern-beads-final-readiness --depends ultramodern-beads-live-control-plane:ultramodern-beads-final-readiness --lanes 4 --max-depth 3
```
