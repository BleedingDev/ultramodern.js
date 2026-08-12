# ARCH-0001: Effect-First + TanStack-First Target Architecture

- Status: Proposed for immediate execution
- Date: 2026-02-22
- Related Beads: `modernjs-44t.1.1`, `modernjs-44t.1.1.2`, `modernjs-44t.1.1.1`
- Related RFC/ADRs:
  - `RFC-0001-super-app-foundation-plan.md`
  - `ADR-0002-app-level-mf-ssr-strategy.md`
  - `ADR-0003-effect-only-mf-data-fetch-reliability.md`
  - `ADR-0004-telemetry-standardization-and-exporters.md`
  - `ADR-0005-cross-project-bff-hardening.md`
  - `ADR-0006-boundary-anti-pattern-checks.md`
  - `BOUNDARY-0001-framework-core-vs-module-vs-external-matrix.md`

## 1. Problem Statement

We need a framework architecture that stays close to upstream Modern.js v3 while becoming production-ready for large, independently deployed super-app systems.

Primary defaults for new work:

- Effect runtime and contract model for cross-project server APIs.
- TanStack Router for app routing and data orchestration.
- Module Federation as a first-class composition model.
- Bun as preferred deployment target.

Compatibility lanes remain available:

- Hono for backward-compatible BFF usage only.
- React Router / Remix paths for backward-compatible routing usage only. React
  Router is maintenance-only: drift-reverts and regression fixes are allowed,
  but no new features or public surface.
- Node deployment remains supported and tested.

## 2. Architectural Principles

1. Upstream-first compatibility:
   - Prefer minimal deltas from Modern.js v3.
   - Keep all deltas explicit and documented.
2. Opinionated in engineering quality:
   - Strong contracts, strict validation, deterministic failures.
   - Release gates and rollback readiness are mandatory.
3. Non-opinionated in business domain:
   - Framework provides infrastructure primitives.
   - CRM/ERP workflows remain module-level implementations.
4. Isolation first:
   - Remote failures should degrade locally, not collapse the whole shell.
   - Tenant and security contexts are enforced server-side, never client-trusted.

## 3. Target Topology

### 3.1 App Composition

- Shell app composes remote apps through Module Federation.
- Remotes must expose compatibility metadata and fallback behavior.
- App-level MF SSR remains behind explicit alpha/feature gates until maturity criteria pass.

### 3.2 API/Server Contract Layer

- Cross-project APIs use Effect-first contracts and typed error semantics.
- Request routing and producer initialization are `requestId`-scoped.
- Data envelope policies are strict-by-default for production cross-project flows.

### 3.3 Security Context

- Tenant/user/operation context is derived and bound server-side.
- Cross-origin behavior is explicit policy, not implicit default behavior.
- MF remote trust is enforced with integrity and origin constraints.

### 3.4 Telemetry + Diagnostics

- Telemetry envelope is standardized and exporter-based.
- OTLP + VictoriaMetrics are first-class exporters.
- RsDoctor remains default-on for build diagnostics; docs define expected artifacts and usage.
- RsDoctor diagnostics discovery is contract-driven via `.rsdoctor/ultramodern-diagnostics.json`.

### 3.5 Runtime Targets

- Preferred target: Bun for deployment/runtime efficiency.
- Compatibility target: Node remains fully supported.
- Contract behavior must be runtime-agnostic across Bun/Node.

## 4. Execution Lanes

Parallel lanes after architecture approval:

- Lane A: Effect-first BFF/data platform hardening.
- Lane B: MF + app-level SSR reliability hardening.
- Lane C: Security and multi-tenant trust boundaries.
- Lane D: Observability, SRE, and release governance.
- Lane E: Platform boundary + module SDK + certification.

Primary blocker before lane execution:

- Architecture review board sign-off with at least two independent subagent reviews.

## 5. Mandatory Gate Template (Per Ticket)

Every ticket must satisfy all gates:

1. Architecture scope reviewed first.
2. Implementation validated with evidence.
3. Tests added/updated and passing.
4. Final review approved by at least two subagents.

This gate model is encoded in Beads labels and acceptance criteria.

## 6. Architecture Risk Decisions

1. Existing Modern.js Hono/React Router surfaces may remain during migration.
2. We reject making Hono or React Router the default for new UltraModern-generated features.
3. We accept temporary alpha-gated app-level MF SSR while reliability hardening completes.
4. We reject client-trusted tenant scope for authorization or cache isolation.

## 7. Enforcement Model (Policy -> CI -> Release)

### 7.1 Default Path Enforcement

1. New cross-project API tickets must include Effect-first contract evidence.
2. New routing/data orchestration tickets must include TanStack-first evidence.
3. Compatibility-lane changes (Hono / React Router/Remix) must be explicitly labeled as backward compatibility.
4. Gate reviews reject tickets that introduce new default-path behavior outside Effect/TanStack lanes.

### 7.2 Security Enforcement

1. Tenant/user context must be server-derived in production paths.
2. Envelope policy must be strict-by-default for cross-project production calls.
3. Cross-origin policy exceptions require explicit documented approval in ticket review logs.
4. SSR header serialization must use deny-first rules for sensitive headers.

### 7.3 MF SSR Alpha Rollout Guardrails

App-level MF SSR alpha promotion requires all:

1. Reliability tests pass for timeout/network/mismatch/degradation scenarios.
2. Fallback telemetry includes remote identity and reason taxonomy.
3. Runtime compatibility digest handshake validates host/remote contract.
4. Rollback path is exercised and documented in release evidence.

### 7.4 Telemetry and Diagnostics Guardrails

Promotion gates require all:

1. Exporter health signals present and non-degraded.
2. Queue drop/backpressure signals under agreed thresholds.
3. RsDoctor artifacts produced according to documented contract.
4. Contract/migration gates pass with attached evidence.

## 8. Done Criteria For ARCH-0001

- Target architecture documented and linked from RFC/ADR index.
- Beads blocker tasks for execution gates and dependency graph are aligned to this architecture.
- Review log captured with:
  - at least two independent review sources,
  - accepted/rejected changes,
  - explicit follow-up actions.
