# BOUNDARY-0001: Framework Core vs Module Layer vs External Integration Matrix

- Status: Implemented
- Date: 2026-02-22
- Related Beads: `modernjs-44t.6.1`
- Related Epic: `modernjs-44t.6`
- Related Architecture: `ARCH-0001-effect-tanstack-target-architecture.md`

## 1. Goal

Define a canonical boundary matrix that keeps UltraModern close to upstream Modern.js while making super-app scale practical:

1. Framework core stays domain-agnostic and stable.
2. Module layer owns business domain behavior (ERP/CRM/etc.).
3. External integration layer owns vendor/protocol specifics.

This prevents business logic creep into framework internals and makes independent deployment + parallel delivery sustainable.

## 2. Layer Definitions

### 2.1 Framework Core (allowed)

Core contains reusable platform primitives only:

1. Runtime composition and module orchestration (MF host/remote lifecycle, compatibility checks, fallback handling).
2. Contract/runtime safety primitives (Effect-first contracts, typed error envelopes, operation context propagation).
3. Security guardrails (tenant binding, SSR leak prevention, origin/integrity/attestation enforcement primitives).
4. Observability primitives (OpenTelemetry envelope, exporter interfaces, SLO hooks, diagnostics plumbing).
5. Build/runtime infrastructure (RsDoctor, Bun/Node adapters, release gating plumbing).

### 2.2 Module Layer (allowed)

Module layer contains domain/business behavior:

1. CRM entities, workflows, automations, reporting semantics.
2. ERP invoicing/project/task rules and state transitions.
3. Product-specific user journeys, permissions policy variants, and UI patterns.
4. Module SDK adapters composed on top of core primitives.

### 2.3 External Integration Layer (allowed)

External layer contains vendor-specific connectors and protocol clients:

1. Banking/payment APIs, invoicing authorities, accounting exports.
2. Email providers (SMTP/IMAP/Graph API), chat/video providers, storage/document suites.
3. Workflow platforms (n8n/Make/Zapier) and BI/monitoring sinks.

## 3. Canonical Matrix

| Capability Family | Framework Core | Module Layer | External Integration | Boundary Decision |
| --- | --- | --- | --- | --- |
| MF runtime, host/remote handshake, fallback taxonomy | Yes | No | No | Core primitive (shared by all products) |
| Effect-first cross-project BFF contracts | Yes | No | No | Core primitive |
| TanStack-first data routing orchestration primitives | Yes | No | No | Core primitive |
| Tenant/user/server-derived identity binding | Yes | No | No | Core security invariant |
| SSR header sanitization and leak guardrails | Yes | No | No | Core security invariant |
| Remote trust checks (origin/integrity/attestation) | Yes | No | No | Core security invariant |
| Telemetry envelope, exporter interfaces, SLO hooks | Yes | No | No | Core observability invariant |
| RsDoctor artifact contract and release gates | Yes | No | No | Core release invariant |
| CRM pipeline stages/opportunity semantics | No | Yes | No | Product-domain behavior |
| Task/project workflow semantics (Gantt/KPI rules) | No | Yes | No | Product-domain behavior |
| Invoice business rules (country/accounting semantics) | No | Yes | No | Product-domain behavior |
| Test management model (test case/run semantics) | No | Yes | No | Product-domain behavior |
| Customer portal business workflows | No | Yes | No | Product-domain behavior |
| Email provider implementation details | No | No | Yes | Vendor/protocol-specific connector |
| Bank pairing implementation details | No | No | Yes | Vendor/protocol-specific connector |
| OnlyOffice/LibreOffice/Drive integration specifics | No | No | Yes | Vendor/protocol-specific connector |
| Video/chat provider transport semantics | No | No | Yes | Vendor/protocol-specific connector |

## 4. Non-Negotiable Rules

1. Framework core must not contain domain entity models (`Deal`, `Invoice`, `Task`, etc.) beyond neutral interfaces.
2. Framework core must not encode country/accounting/legal workflows.
3. Framework core must not hardcode vendor SDK semantics except through stable connector interfaces.
4. Module layer must consume core primitives; it must not bypass security/telemetry contracts.
5. External connector packages must not mutate framework runtime behavior directly.

## 5. Allowed Extension Points

1. `core -> module`: typed SDK interfaces and policy hooks.
2. `module -> external`: connector abstractions and adapter registries.
3. `core -> external`: telemetry exporter interfaces only (no domain behavior).

## 6. Out Of Scope For Framework Core

1. ERP/CRM entity schema standards.
2. BPMN workflow DSL semantics for specific verticals.
3. Pricing/catalog logic.
4. Country-specific finance/tax integrations.
5. Office/chat/email provider product UX features.

## 7. Enforcement Hooks (feeds `modernjs-44t.6.3`)

These checks should be implemented as CI anti-pattern detectors:

1. Block imports of module-domain packages from framework-core packages.
2. Block direct connector SDK usage in framework-core packages.
3. Require telemetry/fallback hook usage in MF host runtime paths.
4. Require server-derived identity propagation in cross-project request plumbing.
5. Require remote trust policy checks before MF app registration.

Implementation status (2026-02-22):

1. Added boundary guard profile:
   - `scripts/boundary-guards/profile.json`
2. Added boundary guard validator + CLI:
   - `scripts/boundary-guards/validator.js`
   - `scripts/boundary-guards/check-boundary-violations.js`
3. Added CI workflow:
   - `.github/workflows/boundary-anti-patterns.yml`

## 8. Parallelization + Dependency Notes

1. This matrix is a prerequisite for:
   - `modernjs-44t.6.2` (module SDK contracts).
   - `modernjs-44t.6.3` (anti-pattern CI checks).
2. `6.2` and `6.3` can run in parallel once this matrix is accepted.
3. `6.4` remains sequentially blocked by `6.2`, `6.3`, and release-governance gates.

## 9. Validation Checklist For Future PRs

Use this checklist whenever new platform functionality is proposed:

1. Is this capability reusable across multiple business domains?
2. Does it enforce or expose a platform invariant (security/observability/runtime contract)?
3. Could this change lock us into one ERP/CRM workflow or vendor?
4. If yes to (3), it belongs to Module or External layer, not Framework Core.
