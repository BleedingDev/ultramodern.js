# WORKSPACE-0001: Micro Vertical Workspace Scaffolding

- Status: Proposed
- Date: 2026-04-29
- Amended by: `ADR-0019-federated-loading-unified-delivery.md`
- Related Plan: `.codex/plans/ultramodern-mv-workspace-scaffolding.plan.md`
- Depends on:
  - `DELIVERY-0001-micro-vertical-reference-delivery.md`
  - `ADR-0019-federated-loading-unified-delivery.md`
  - `ADR-0012-mv-topology-manifest-and-zephyr-profile.md`
  - `ADR-0014-mv-template-supply-chain-policy.md`
  - `packages/toolkit/ultramodern-create/README.md`
  - `packages/toolkit/ultramodern-create/template-workspace/`
  - `packages/toolkit/ultramodern-create/templates/`

## 1. Purpose

This document defines the canonical downstream workspace shape for teams adopting Micro Verticals on top of the single public `presetUltramodern(...)` entrypoint.

The goal is not a second framework mode. The goal is a repeatable repo layout and scaffold recipe that lets teams create shell, remote, service, and shared-package slices while staying aligned with the completed TanStack, Module Federation, Effect HttpApi, topology, and certification contracts.

This document is not a migration guide or codemod plan. Existing-app migration guidance is intentionally deferred from this framework topology scope.

## 2. Canonical Workspace Topology

A Micro Vertical workspace uses these package roles:

| Package class | Example path | Owner | Primary contract |
| --- | --- | --- | --- |
| Shell app | `apps/shell` | Platform shell owner | Route assembly, trust policy, topology selection, global telemetry, fallback policy |
| Remote vertical | `apps/remotes/<vertical>` | Vertical owner | MicroVertical delivery unit: route subtree, composition surfaces, delivery-unit identity, degradation UI |
| Service | `services/<service>` | Service owner | Effect HttpApi boundary; same MicroVertical delivery unit when it is that vertical's server capability, separate delivery unit when cross-vertical |
| Shared package | `packages/<name>` | Platform or vertical owner | Tokens, primitives, domain-neutral utilities, generated clients |
| Horizontal design-system remote | `apps/remotes/design-system` | Design-system owner | Separate delivery unit for cross-vertical tokens/primitives when independent promotion is required |

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

Directory/package boundaries are not release boundaries. A service package that provides one MicroVertical's server capability belongs to that MicroVertical delivery unit even when it lives under `services/`.

## 3. Scaffold Recipes

Use the existing BleedingDev create entrypoint and add MicroVerticals from the
workspace root with the UltraModern add flow. The add flow derives paths,
package names, ports, Module Federation names, topology entries, overlays,
ownership, and root dev scripts from the requested vertical name.

The supported pnpm invocation is the scoped package specifier,
`pnpm dlx @bleedingdev/modern-js-ultramodern-create <target>`. The bare
`pnpm dlx modern-js-ultramodern-create` lookup is not supported because no
unscoped `modern-js-ultramodern-create` package is published.

### 3.1 Initial workspace

```bash
pnpm dlx @bleedingdev/modern-js-ultramodern-create my-super-app
```

Shell requirements:

1. use `presetUltramodern(...)` as the public config wrapper.
2. own topology manifest selection, not hardcoded remote URLs.
3. own route tree assembly and fallback taxonomy.
4. preserve the generated app-specific `appId` and stamped `deliveryUnit` options.
5. use typed preset options for preset-owned opt-outs and ordinary app config
   for app-owned overrides.
6. leave telemetry exporters unconfigured until
   `MODERN_TELEMETRY_OTLP_ENDPOINT` or
   `MODERN_TELEMETRY_VICTORIA_ENDPOINT` supplies the matching endpoint. Each
   variable enables only its matching exporter.

Reference proof:

1. `tests/integration/routes-tanstack-mf/mf-host`
2. `tests/integration/routes-tanstack-mf/test/index.test.ts`

### 3.2 Full-stack vertical

```bash
pnpm dlx @bleedingdev/modern-js-ultramodern-create catalog --vertical
```

Vertical requirements:

1. own its route subtree, loader/action bridge, local presentation, and degraded UI.
2. publish composition-surface artifacts through one MicroVertical delivery-unit identity.
3. emit remote failure and fallback telemetry.
4. declare ownership metadata before production rollout.
5. own its Effect HttpApi BFF contract and generated client in the same delivery unit.

Reference proof:

1. `tests/integration/routes-tanstack-mf/mf-remote`
2. `tests/integration/routes-tanstack-mf/mf-remote-2`

### 3.3 Horizontal remote

The create package does not expose a `horizontal-remote` mode. Use an ordinary
workspace package for shared design tokens and primitives. If the surface needs
independent deployment, rollback, and incident ownership, model it explicitly
as a separately owned delivery unit rather than disguising it as generator
sugar.

Horizontal remote requirements:

1. own a cross-vertical delivery unit such as independently promoted UI primitives.
2. use the same topology, trust, SSR compatibility, and fallback contracts as vertical remotes.
3. avoid becoming a second framework mode or shared global application state.

### 3.4 Service package

Effect-first service:

The create package does not expose a service-only mode. A generated
`--vertical` owns its Effect HttpApi BFF and client. A genuinely cross-vertical
service requires an explicit delivery-unit design outside the create surface.

Service requirements:

1. expose explicit operation contracts.
2. preserve trace, locale, auth, and session propagation through `createRequestContextHeaders(...)`.
3. model HTTP endpoints through Effect HttpApi contracts and typed error channels.
4. publish service references through topology metadata, not source-level environment URLs.
5. declare whether the service is the server capability of one MicroVertical delivery unit or a separate cross-vertical delivery unit.

Reference proof:

1. `tests/integration/bff-runtime-parity`
2. `tests/integration/bff-cross-project`

### 3.5 Shared package

Shared packages are created as normal workspace packages, not by a special
create mode and not as app remotes.

When the design system needs an independent release boundary, create it as a horizontal Module Federation remote delivery unit instead of treating it as a special framework subsystem. It must use the same topology, trust, compatibility, SSR, and fallback expectations as vertical remotes.

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
4. rehearse cross-delivery-unit compatibility by pinning one delivery-unit artifact while another uses workspace source.
5. rehearse remote-unavailable behavior by disabling or stopping a remote process.
6. reject frontend/API/backend marker mismatch inside one MicroVertical as a negative validation path, not a supported local development mode.

Minimum local commands:

```bash
pnpm --filter @my-super-app/remote-catalog dev
pnpm --filter @my-super-app/service-catalog-api-effect dev
pnpm --filter @my-super-app/shell-super-app dev
```

Cross-delivery-unit compatibility rehearsal:

```bash
pnpm --filter @my-super-app/remote-catalog build
pnpm --filter @my-super-app/shell-super-app dev
```

The shell must still resolve the remote through topology references and fallback when the selected artifact is unavailable, revoked, or incompatible.

## 5. Smoke-Test Contract

A generated Micro Vertical workspace is scaffold-ready only when these checks have a repo-backed equivalent:

| Surface | Required proof |
| --- | --- |
| Shell + remote route composition | `pnpm --dir tests exec rstest run integration/routes-tanstack-mf/test/index.test.ts` |
| MF manifest and shared tree-shaking metadata | `tests/integration/routes-tanstack-mf/tests/tanstack-mf-contract.test.ts` |
| Effect service propagation | `tests/integration/bff-runtime-parity` and `tests/integration/bff-cross-project` |
| Template manifest and supply-chain policy | `packages/toolkit/ultramodern-create/src/index.ts` manifest validation and `.modernjs/mv-template-manifest.json` output |
| Release gate compatibility | `pnpm run validate:bun-smoke` |

The minimal topology smoke path is `pnpm run validate:mv-topology-smoke`.
Graph handoff metadata for plan/subagent orchestration lives at
`docs/super-app-rfc-adr/evidence/mv-topology-smoke/current/graph-handoff.json`.

## 6. Generator Surface Policy

The create package exposes one initial SuperApp workspace flow and one
full-stack MicroVertical add flow:

1. The default command creates a shell-only SuperApp workspace.
2. `--vertical` adds a full-stack vertical with TanStack Router, Module
   Federation, Effect HttpApi BFF, ownership, topology, i18n, and Tailwind
   contracts.
3. `--vertical --dry-run` validates and reports the exact mutation plan without
   writing files.
4. The public API and CodeSmith adapter expose the same workspace and vertical
   operations for automation.
5. Generated UltraModern HTTP APIs do not use `--bff-runtime hono`.

Do not advertise a `--microvertical` compatibility surface. Service-only,
shared-package, and horizontal-remote modes remain outside the generator until
they have real producers, consumers, and focused behavioral proof.

## 7. Acceptance Checklist

A workspace is ready for Micro Vertical adoption when:

1. shell, remote, service, and shared packages have distinct owners.
2. shell source uses topology references rather than environment URLs.
3. remote packages own degraded UI and fallback telemetry.
4. service packages use Effect HttpApi for generated HTTP APIs.
5. shared packages expose tokens, primitives, generated clients, or domain-neutral utilities only.
6. local orchestration can run shell, remote, and service processes together.
7. cross-delivery-unit compatibility and remote-unavailable scenarios are rehearsed before production certification without permitting frontend/API/backend drift inside one MicroVertical.
