# DELIVERY-0001: Micro Vertical Reference Delivery

- Status: Accepted
- Date: 2026-04-22
- Related Plans:
  - `ultramodern-single-preset-mv-program.plan.md`
  - `ultramodern-mv-core-router-seams.plan.md`
  - `ultramodern-mv-effect-bff-contracts.plan.md`
  - `ultramodern-mv-mf-shell-ssr-contracts.plan.md`
  - `ultramodern-mv-delivery-layer.plan.md`

## 1. Goal

Define the reference delivery model for true Micro Verticals in this repo now that the single public `presetUltramodern(...)` surface, router seams, MF SSR contracts, and Effect/BFF propagation seams are in place.

The target is one adoption path:

1. start as one `presetUltramodern(...)` app,
2. split feature slices into shell-owned route modules,
3. graduate isolated slices into MF remotes,
4. move cross-project data and workflows into strict Effect or explicit Hono service contracts.

This document is the missing delivery bridge between the completed framework work and downstream super-app adoption.

## 2. Reference Topology

### 2.1 Shell

The shell owns:

- global route tree assembly,
- navigation chrome,
- cross-vertical auth/session bootstrapping,
- remote trust and compatibility policy,
- platform telemetry, fallback UI, and release gates.

Reference implementation:

- TanStack shell + MF routing: [tests/integration/routes-tanstack-mf/mf-host](/Users/satan/side/experiments/modernjs/tests/integration/routes-tanstack-mf/mf-host)
- app-level MF SSR + fallback reliability: [tests/integration/routes-tanstack-mf/test](/Users/satan/side/experiments/modernjs/tests/integration/routes-tanstack-mf/test)

### 2.2 Remote Vertical

A remote owns:

- its route subtree and local loader/mutation logic,
- remote-local presentational components,
- remote-local BFF client projections,
- degradation behavior when shell context is incomplete.

Reference implementations:

- primary remote: [tests/integration/routes-tanstack-mf/mf-remote](/Users/satan/side/experiments/modernjs/tests/integration/routes-tanstack-mf/mf-remote)
- secondary remote: [tests/integration/routes-tanstack-mf/mf-remote-2](/Users/satan/side/experiments/modernjs/tests/integration/routes-tanstack-mf/mf-remote-2)

### 2.3 Service Boundary

An independent service owns:

- effect or hono transport/runtime,
- operation contracts,
- request/trace/locale propagation,
- cross-project identity and envelope policy,
- compatibility across dev, build, and deployed runtimes.

Reference implementations:

- cross-project producer/consumer apps: [tests/integration/bff-corss-project](/Users/satan/side/experiments/modernjs/tests/integration/bff-corss-project)
- build/serve parity and generated client proof: [tests/integration/bff-runtime-parity](/Users/satan/side/experiments/modernjs/tests/integration/bff-runtime-parity)
- explicit Hono compatibility lane: [tests/integration/bff-hono](/Users/satan/side/experiments/modernjs/tests/integration/bff-hono)

## 3. Extraction Workflow

### 3.1 Keep It in the Shell First

A feature starts shell-local when:

- route ownership is still unstable,
- UI and loaders are tightly coupled to global navigation,
- release cadence is shared with the shell,
- remote failure isolation would not yet buy anything.

### 3.2 Split Into a Remote When

Promote a slice to an MF remote when all are true:

- the route subtree has stable ownership,
- the feature can degrade independently,
- the route can tolerate host/remote version skew via compatibility/trust checks,
- the vertical benefits from an independent release train.

Required handoff surfaces:

- route ownership metadata,
- loader bridge contract,
- fallback UI,
- remote trust metadata,
- compatibility digest.

Canonical example:

- [tests/integration/routes-tanstack-mf/tests/tanstack-mf-contract.test.ts](/Users/satan/side/experiments/modernjs/tests/integration/routes-tanstack-mf/tests/tanstack-mf-contract.test.ts)

### 3.3 Split Into an Independent Service When

Promote data/workflow logic out of the shell or remote when:

- multiple apps or remotes consume the contract,
- identity, locale, or trace propagation must remain stable across deployment boundaries,
- request hardening or envelope policy matters more than in-process convenience,
- the runtime needs an independent scale/failure boundary.

Preferred path:

- Effect-first for new strict contracts.

Compatibility path:

- Hono remains explicit for existing Modern.js-style handlers.

Canonical references:

- strict Effect propagation helpers: [packages/server/create-request/src/requestContext.ts](/Users/satan/side/experiments/modernjs/packages/server/create-request/src/requestContext.ts)
- generated Effect client propagation seam: [packages/cli/plugin-bff/src/utils/effectClientGenerator.ts](/Users/satan/side/experiments/modernjs/packages/cli/plugin-bff/src/utils/effectClientGenerator.ts)

## 4. Shared Design-System Strategy

Do not expose a whole app shell as a design-system dependency.

Use three layers instead:

1. `design tokens` shared widely and versioned conservatively,
2. `primitive UI components` shared when behavior is genuinely cross-vertical,
3. `feature composites` owned by one vertical and never treated as cross-team platform API.

Rules:

- shell owns brand, layout frame, and cross-vertical interaction grammar,
- remotes own feature composites,
- shared packages expose primitives and tokens, not business workflow assumptions.

## 5. Developer Ergonomics Checklist

For a new Micro Vertical under `presetUltramodern(...)`:

1. Start inside one app with the public preset.
2. Prove route/data ownership locally.
3. Add contract coverage before extracting a remote or service.
4. Use generated request-context helpers instead of ad hoc locale/trace header plumbing.
5. Keep Hono usage explicit and compatibility-scoped.
6. Require fallback behavior and telemetry before independent deployment.
7. Keep shell/remote/service boundaries visible in release gates and certification evidence.

## 6. Result

The repo now has one explicit delivery story:

- `presetUltramodern(...)` is the single public entrypoint,
- TanStack + MF provides the preferred shell/remote composition path,
- Effect provides the preferred service contract path,
- Hono remains an explicit compatibility lane,
- and the reference examples above are the canonical adoption guides for downstream teams.
