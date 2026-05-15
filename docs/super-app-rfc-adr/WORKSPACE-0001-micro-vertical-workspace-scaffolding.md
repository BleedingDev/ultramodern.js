# WORKSPACE-0001: Micro Vertical Workspace Scaffolding

- Status: Proposed
- Date: 2026-04-29
- Related Plan: `.codex/plans/ultramodern-mv-workspace-scaffolding.plan.md`
- Depends on:
  - `DELIVERY-0001-micro-vertical-reference-delivery.md`
  - `ADR-0012-mv-topology-manifest-and-zephyr-profile.md`
  - `ADR-0014-mv-template-supply-chain-policy.md`
  - `packages/toolkit/create/README.md`
  - `packages/toolkit/create/template/README.md`

## 1. Purpose

This document defines the canonical downstream workspace shape for teams adopting Micro Verticals on top of the single public `presetUltramodern(...)` entrypoint.

The goal is not a second framework mode. The goal is a repeatable repo layout and scaffold recipe that lets teams create shell, remote, service, and shared-package slices while staying aligned with the completed TanStack, Module Federation, Effect, Hono, topology, and certification contracts.

This document is not a migration guide or codemod plan. Existing-app migration guidance is intentionally deferred from this framework topology scope.

## 2. Canonical Workspace Topology

A Micro Vertical workspace uses these package roles:

| Package class | Example path | Owner | Primary contract |
| --- | --- | --- | --- |
| Shell app | `apps/shell` | Platform shell owner | Route assembly, trust policy, topology selection, global telemetry, fallback policy |
| Remote vertical | `apps/remotes/<vertical>` | Vertical owner | Route subtree, remote-local loader/action behavior, remote manifest, degradation UI |
| Service | `services/<service>` | Service owner | Effect API boundary, request context propagation, operation contracts; Hono only as explicit compatibility |
| Shared package | `packages/<name>` | Platform or vertical owner | Tokens, primitives, domain-neutral utilities, generated clients |
| Horizontal design-system remote | `apps/remotes/design-system` | Design-system owner | Module Federation remote for tokens/primitives when independent deployment is required |

The workspace root owns package-manager configuration, CI orchestration, shared lint/test tooling, and release-gate entrypoints. It must not own feature workflow code.

Recommended root shape:

```text
micro-vertical-workspace/
  apps/
    shell/
    remotes/
      catalog/
      checkout/
      design-system/
  services/
    catalog-api/
    checkout-api/
  packages/
    design-tokens/
    ui-primitives/
    service-clients/
  docs/
    topology/
    evidence/
```

## 3. Scaffold Recipes

Use the existing `@modern-js/create` surface and compose the workspace from generated packages.

### 3.1 Shell app

```bash
npx @modern-js/create apps/shell --router tanstack --tailwind --workspace --sub
```

Shell requirements:

1. use `presetUltramodern(...)` as the public config wrapper.
2. own topology manifest selection, not hardcoded remote URLs.
3. own route tree assembly and fallback taxonomy.
4. keep `MODERN_BASELINE_ENABLE_MF_SSR` explicit when MF SSR is enabled or intentionally disabled.

Reference proof:

1. `tests/integration/routes-tanstack-mf/mf-host`
2. `tests/integration/routes-tanstack-mf/test/index.test.ts`

### 3.2 Remote vertical

```bash
npx @modern-js/create apps/remotes/catalog --router tanstack --tailwind --workspace --sub
```

Remote requirements:

1. own its route subtree, loader/action bridge, local presentation, and degraded UI.
2. publish MF manifest artifacts through the topology manifest.
3. emit remote failure and fallback telemetry.
4. declare ownership metadata before production rollout.

Reference proof:

1. `tests/integration/routes-tanstack-mf/mf-remote`
2. `tests/integration/routes-tanstack-mf/mf-remote-2`

### 3.3 Service package

Effect-first service:

```bash
npx @modern-js/create services/catalog-api --bff-runtime effect --workspace --sub
```

Hono compatibility service:

```bash
npx @modern-js/create services/catalog-api --bff-runtime hono --workspace --sub
```

Service requirements:

1. expose explicit operation contracts.
2. preserve trace, locale, auth, and session propagation through `createRequestContextHeaders(...)`.
3. keep Hono usage explicit as a compatibility lane.
4. publish service references through topology metadata, not source-level environment URLs.

Reference proof:

1. `tests/integration/bff-runtime-parity`
2. `tests/integration/bff-corss-project`
3. `tests/integration/bff-hono`

### 3.4 Shared package

Shared packages are created as normal workspace packages, not app remotes.

When the design system needs an independent release train, create it as a horizontal Module Federation remote instead of treating it as a special framework subsystem. It must use the same topology, trust, compatibility, SSR, and fallback expectations as vertical remotes.

Allowed shared-package roles:

1. design tokens.
2. primitive UI components.
3. generated clients.
4. domain-neutral utilities.

Disallowed shared-package roles:

1. feature composites.
2. cross-vertical workflow state machines.
3. remote-local loader logic.
4. service implementation shortcuts.

## 4. Local Development Orchestration

Local orchestration should model production boundaries while keeping iteration fast:

1. use `workspace:*` dependencies through `--workspace` for local Modern.js package testing.
2. run shell, remotes, and services as separate processes on stable local ports.
3. resolve remotes and services through a local topology overlay.
4. simulate version skew by pinning one package to a built artifact while another uses workspace source.
5. rehearse remote-unavailable behavior by disabling or stopping a remote process.

Minimum local commands:

```bash
pnpm --dir apps/remotes/catalog dev
pnpm --dir services/catalog-api dev
pnpm --dir apps/shell dev
```

Version-skew rehearsal:

```bash
pnpm --dir apps/remotes/catalog build
pnpm --dir apps/shell dev
```

The shell must still resolve the remote through topology references and fallback when the selected artifact is unavailable, revoked, or incompatible.

## 5. Smoke-Test Contract

A generated Micro Vertical workspace is scaffold-ready only when these checks have a repo-backed equivalent:

| Surface | Required proof |
| --- | --- |
| Shell + remote route composition | `pnpm --dir tests exec rstest run integration/routes-tanstack-mf/test/index.test.ts` |
| MF manifest and shared tree-shaking metadata | `tests/integration/routes-tanstack-mf/tests/tanstack-mf-contract.test.ts` |
| Effect service propagation | `tests/integration/bff-runtime-parity` and `tests/integration/bff-corss-project` |
| Hono compatibility lane | `tests/integration/bff-hono` |
| Template manifest and supply-chain policy | `packages/toolkit/create/src/index.ts` manifest validation and `.modernjs/mv-template-manifest.json` output |
| Release gate compatibility | `pnpm run validate:bun-smoke` |

The minimal topology smoke path is `pnpm run validate:mv-topology-smoke`.
Graph handoff metadata for plan/subagent orchestration lives at
`docs/super-app-rfc-adr/evidence/mv-topology-smoke/current/graph-handoff.json`.

## 6. Generator Surface Policy

The create package already exposes the primitives needed to scaffold the topology:

1. `--router tanstack` for the Golden router path.
2. `--bff-runtime effect` for strict new service contracts.
3. `--bff-runtime hono` for compatibility services.
4. `--workspace` for local monorepo package development.
5. `--sub` for package-in-workspace generation without root-level hooks.

New CLI flags should be added only when they produce materially different files. Until then, Micro Vertical scaffolding is a documented composition of these existing flags, plus workspace root orchestration and topology metadata.

## 7. Acceptance Checklist

A workspace is ready for Micro Vertical adoption when:

1. shell, remote, service, and shared packages have distinct owners.
2. shell source uses topology references rather than environment URLs.
3. remote packages own degraded UI and fallback telemetry.
4. service packages use Effect or explicit Hono lanes.
5. shared packages expose tokens, primitives, generated clients, or domain-neutral utilities only.
6. local orchestration can run shell, remote, and service processes together.
7. version-skew and remote-unavailable scenarios are rehearsed before production certification.
