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
  - Current status: completed
  - Active todo: none
  - Beads issue: `modernjs-wrf`
  - Completed todos: `tpcore-01`, `tpcore-02`, `tpcore-03`, `tpcore-04`
  - Runtime core audit agent: `019e2853-a476-7313-a7da-049afaa8e412` (closed)
  - PR #8317 prototype audit agent: `019e2853-a4e1-7092-a17a-551466f0c0e8` (closed)
  - MF fixture dirty patch audit agent: `019e2853-a551-7973-8acc-2e5f0aaecd14` (closed)
  - CLI implementation worker: `019e285b-187f-7920-a037-e238181e5438` (Hooke, closed)
  - SSR implementation worker: `019e2865-05c3-7c90-938b-2c0a80eeb142` (Bernoulli, closed)
  - Core proof worker: `019e286e-6096-7d71-b304-3d9ef5fedfab` (Anscombe, closed)
  - Owner: complete
  - Next action: `tanstack-router-plugin-package` / `tplug-01` is unblocked.
- `tanstack-plugin-core-hooks` / `tpcore-03` prep
  - Current status: read-only prep complete
  - SSR hook prep explorer: `019e285b-37bb-7f12-b57c-4dfa6a2b6f5e` (Chandrasekhar, closed)
  - Output: `.codex/reports/tpcore-03-ssr-hook-prep.md`
- `tanstack-router-plugin-package` / `tplug-01` prep
  - Current status: read-only prep complete
  - Package extraction prep explorer: `019e285b-66e4-7682-ac8e-8dfd904565ca` (Mencius, closed)
  - Output: `.codex/reports/tplug-01-package-extraction-prep.md`
  - Blocked implementation by: `tanstack-plugin-core-hooks`
- `tanstack-router-plugin-package`
  - Current status: ready
  - Active todo: `tplug-04` (pending)
  - Blocked by: none
  - Beads issue: `modernjs-wrf`
  - Completed todos: `tplug-01`, `tplug-02`, `tplug-03`
  - Package scaffold worker: `019e2871-e3d3-7580-86fa-4350bbc0fdaa` (Tesla, closed)
  - Plugin CLI worker: `019e287a-e70e-7593-b565-d9ff2a7463a1` (Cicero, closed)
  - Runtime extraction worker: `019e2885-0f73-7b70-b3c8-0d182dbca378` (Peirce, closed; completed locally after typecheck fixes)
  - Next action: wire create templates and TanStack fixtures to enable `tanstackRouterPlugin(...)` explicitly.
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
