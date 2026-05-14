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
  - Active todo: `unes-02`
  - Owner: Effect/BFF service surface
  - Next action: align public BFF/service surface around Effect-first exports, generator defaults, and docs.
  - Completed: `unes-01` upgraded Effect dependencies to `4.0.0-beta.66`, changed `effect/ServiceMap` to `effect/Context`, and passed plugin build/tests in a detached worktree.
- `ultramodern-next-tanstack-mf-ssr`
  - Current status: ready
  - Active todo: `untms-01`
  - Owner: TanStack + Module Federation SSR contract
  - Next action: inventory SSR, hydration, loader/action, fallback, and version-skew gaps.
- `ultramodern-next-mv-preset-topology`
  - Current status: blocked
  - Blocked by: Effect service surface and TanStack MF SSR contract
  - Owner: presetUltramodern topology/productization
  - Next action: start only after both upstream lanes produce stable contracts.

## Scope Locks

- One preset only: `presetUltramodern`.
- Effect v4 beta is accepted.
- Design system is a horizontal Module Federation remote, not a special framework subsystem.
- AI/MCP/agent operations are out of runtime scope.
- Migration guides and codemods are deferred.
