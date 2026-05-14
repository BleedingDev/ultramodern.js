# TanStack Plugin First-Class SSR Operator Log

## Handoff

- Graph ID: `tanstack-plugin-first-class-ssr`
- Selection hash: `b764229b15`
- Snapshot: `.codex/plan-graphs/tanstack-plugin-first-class-ssr/snapshot.json`
- Plan selection:
  - `.codex/plans/tanstack-plugin-core-hooks.plan.md`
  - `.codex/plans/tanstack-router-plugin-package.plan.md`
  - `.codex/plans/tanstack-plugin-ssr-mf-contract.plan.md`
  - `.codex/plans/tanstack-upstream-review-branch.plan.md`
- Dependency edges:
  - `tanstack-plugin-core-hooks:tanstack-router-plugin-package`
  - `tanstack-router-plugin-package:tanstack-plugin-ssr-mf-contract`
  - `tanstack-plugin-ssr-mf-contract:tanstack-upstream-review-branch`

## Live Lanes

- `tanstack-plugin-core-hooks`
  - Current status: ready
  - Active todo: `tpcore-02`
  - Beads issue: `modernjs-wrf`
  - Completed todo: `tpcore-01`
  - Runtime core audit agent: `019e2853-a476-7313-a7da-049afaa8e412` (closed)
  - PR #8317 prototype audit agent: `019e2853-a4e1-7092-a17a-551466f0c0e8` (closed)
  - MF fixture dirty patch audit agent: `019e2853-a551-7973-8acc-2e5f0aaecd14` (closed)
  - Owner: generic router CLI extension points
  - Next action: implement scoped route directory metadata, scoped entry generation, generated-routes return values, file-change regeneration, and nested route-spec merge without adding TanStack dependencies to runtime core.
- `tanstack-router-plugin-package`
  - Current status: blocked
  - Blocked by: `tanstack-plugin-core-hooks`
  - Beads issue: `modernjs-wrf`
  - Next action: scaffold plugin only after core hook audit is accepted.
- `tanstack-plugin-ssr-mf-contract`
  - Current status: blocked
  - Blocked by: `tanstack-router-plugin-package`
  - Beads issue: `modernjs-vq0`
  - Next action: clean `routes-tanstack-mf` patch only after plugin architecture is stable.
- `tanstack-upstream-review-branch`
  - Current status: blocked
  - Blocked by: `tanstack-plugin-ssr-mf-contract`
  - Owner: upstream PR #8317 polish and force-push
  - Next action: after implementation is complete, rebuild the review branch on `origin/main` and force-push only minimal mergeable changes to `bleedingdev/feat/tanstack-router-tailwind-first-class`.

## Scope Locks

- TanStack package dependencies must move to `@modern-js/plugin-tanstack`.
- `@modern-js/runtime` core may only gain generic extension hooks.
- Do not create `presetMicroVerticals`.
- Do not touch unrelated dirty files.
- The existing dirty `tests/integration/routes-tanstack-mf/**` patch is evidence for the SSR seam; do not revert it unless explicitly instructed.
- Do not force-push PR #8317 branch until the final diff is audited against upstream `origin/main`.
