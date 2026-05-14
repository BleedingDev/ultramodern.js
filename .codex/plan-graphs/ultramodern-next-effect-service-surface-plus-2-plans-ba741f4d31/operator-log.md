# Ultramodern Next MV Graph Operator Log

## Handoff

- Graph ID: `ultramodern-next-effect-service-surface-plus-2-plans-ba741f4d31`
- Selection hash: `ba741f4d31`
- Snapshot: `.codex/plan-graphs/ultramodern-next-effect-service-surface-plus-2-plans-ba741f4d31/snapshot.json`
- Plan selection:
  - `.codex/plans/ultramodern-next-effect-service-surface.plan.md`
  - `.codex/plans/ultramodern-next-tanstack-mf-ssr.plan.md`
  - `.codex/plans/ultramodern-next-mv-preset-topology.plan.md`
- Dependency edges:
  - `ultramodern-next-effect-service-surface:ultramodern-next-mv-preset-topology`
  - `ultramodern-next-tanstack-mf-ssr:ultramodern-next-mv-preset-topology`

## Live Lanes

- `ultramodern-next-effect-service-surface`
  - Current status: ready
  - Active todo: `unes-04`
  - Beads issue: `modernjs-2ub`
  - Completed propagation agent: `019e2830-188a-7d20-9728-08223f6af406`
  - Completed Hono surface audit agent: `019e2830-1947-7321-b414-85a7ac9bb9fb`
  - Completed agent: `019e281f-ea4e-7850-b76e-1fab19a80bf2`
  - Owner: Effect/BFF service surface
  - Next action: add minimal release-gate evidence that an Effect service can act as a Micro Vertical backend boundary without ad hoc header plumbing.
  - Completed: `unes-01` upgraded Effect dependencies to `4.0.0-beta.66`, changed `effect/ServiceMap` to `effect/Context`, and passed plugin build/tests in a detached worktree.
  - Completed: `unes-02` landed in `96e4bd06df`; `@modern-js/plugin-bff/server` is Effect-first and `@modern-js/plugin-bff/hono-server` is explicit compatibility.
  - Completed: `unes-03` added propagation proof for auth, tenant, locale, trace, and correlation headers across Effect request/context surfaces and audited Hono compatibility imports.
- `ultramodern-next-tanstack-mf-ssr`
  - Current status: ready
  - Active todo: `untms-02`
  - Beads issue: `modernjs-6o2`
  - Completed SSR fixture attempt agent: `019e2830-18e9-75e1-8d1b-cce031aa00e2`
  - Completed contract agent: `019e2820-1775-7791-9f92-d242b6fb3460`
  - Completed scout agent: `019e2820-3baa-7013-a86d-6384631bf68c`
  - Completed action bridge agent: `019e2824-9e9b-7313-94d0-3a3b61f8df5e`
  - Owner: TanStack + Module Federation SSR contract
  - Next action: convert the shell-to-remote SSR contract into executable fixtures for a shell route subtree backed by independently built TanStack MF remotes.
  - Scout finding: current fixture is intentionally CSR and labels `federated-content-ssr` as a gap. Separate action bridge worker owns generated `modernRouteAction` static-data support under `packages/runtime/plugin-runtime/src/router/cli/code/**`.
  - Completed: `untms-01` added the executable gap matrix and report. `federated-content-ssr` remains the primary gap; action handoff is now covered by generated `modernRouteAction` static data.
  - Attempted: `untms-02` fixture worker proved shell SSR can be expressed, but remote component SSR still needs a runtime seam: server-side TanStack/MF remote module loading and render-before-hydration. The current fixture patch needs cleanup before landing.
  - PR #8317 constraint: TanStack must be plugin-owned (`@modern-js/plugin-tanstack`) and core changes should be generic router/SSR hooks. Track plugin extraction in `modernjs-wrf` and fixture cleanup in `modernjs-vq0`.
- `ultramodern-next-mv-preset-topology`
  - Current status: blocked
  - Blocked by: Effect service surface and TanStack MF SSR contract
  - Beads issue: `modernjs-3bc`
  - Completed prep scout agent: `019e2820-591e-75e0-8bf1-32cbf6fb06b5`
  - Owner: presetUltramodern topology/productization
  - Next action: start only after both upstream lanes produce stable contracts.
  - Prepared acceptance: shell + two vertical remotes + one `horizontal-design-system` MF remote + one Effect service. Topology must resolve IDs through manifest metadata, model DS as an MF remote, and avoid copying hardcoded localhost remote URLs from current fixtures.

## Scope Locks

- One preset only: `presetUltramodern`.
- Effect v4 beta is accepted.
- Design system is a horizontal Module Federation remote, not a special framework subsystem.
- AI/MCP/agent operations are out of runtime scope.
- Migration guides and codemods are deferred.
