# BASELINE-0001: Current vs Target Contract Baseline

- Status: Active baseline
- Date: 2026-02-22
- Related Beads: `modernjs-44t.1.1.1`
- Scope: Framework contracts for super-app foundation hardening

## 1. Baseline Summary

This baseline compares the current implementation state against the target architecture in `ARCH-0001-effect-tanstack-target-architecture.md`.

It is intentionally framework-focused (not domain workflow-focused), to keep Modern.js v3 compatibility while hardening platform guarantees.

## 2. Contract Matrix

| Contract Area | Current State | Target State | Gap Type | Evidence Required | Follow-up Stream |
| --- | --- | --- | --- | --- | --- |
| Routing default | Multiple supported paths | TanStack-first default, legacy routing as compatibility lane | Policy/documentation + enforcement | CI/review evidence that new tickets default to TanStack path | Lane B, Lane E |
| BFF runtime default | Mixed legacy + Effect paths | Effect-first for new cross-project APIs | Default behavior + migration policy | Gate evidence that new cross-project APIs use Effect contracts | Lane A |
| Producer bootstrap (`requestId`) | Hardening exists, but still easy to misconfigure manually | Auto-bootstrap and fail-fast domain/header validation | Runtime ergonomics + validation | Startup/runtime validation outputs and integration tests | Lane A |
| Header/domain propagation | Stronger than baseline, still context-sensitive | Uniform secure propagation policy for all cross-project request modes | Contract and middleware consistency | Cross-project integration tests + policy assertions | Lane A, Lane C |
| Data envelope policy | Available but configuration-sensitive | Strict-by-default in production with explicit cross-origin policy | Security default hardening | Production policy check + negative tests | Lane A, Lane C |
| MF runtime compatibility | Shared version contracts and tests present | Runtime digest handshake and hard-fail compatibility checks | Runtime hardening | Host/remote compatibility validation + failure tests | Lane B |
| MF manifest trust | Manifest/entry served and consumed | Integrity and origin trust policy mandatory | Security hardening | Integrity verification evidence + origin allowlist tests | Lane B, Lane C |
| App-level MF SSR | Alpha contracts and fallback path | Mature, measurable, rollout-gated runtime path | Reliability + rollout gates | Alpha promotion checklist with telemetry/fallback thresholds | Lane B, Lane D |
| Tenant identity enforcement | Contract surfaces exist, server binding not globally enforced | Server-derived tenant/user/operation context mandatory | Security architecture gap | Runtime assertions + audit trace evidence | Lane C |
| SSR header safety | Configurable behavior with risk of misuse | Explicit deny policies and leak-prevention checks | Security hardening | SSR leak-prevention automated checks | Lane C |
| Telemetry envelope/exporters | Core envelope and exporters in place | Fail-loud startup policy + exporter health SLO + queue drop visibility | SRE hardening | Startup health checks + SLO dashboards + alerts | Lane D |
| Diagnostics (RsDoctor) | Default-on build path established | Standardized diagnostics artifact contract for coding-agent/dev workflows | DX hardening | Artifact contract docs + CI artifact verification | Lane D |
| Release/canary/rollback | Existing CI and branch workflows | Automated canary and rollback orchestration tied to contract + telemetry gates | Delivery hardening | Canary/rollback drill evidence + gate pipeline outputs | Lane D |
| Platform boundaries | Discussed in RFC/ADR | Enforced matrix, module SDK contracts, and certification gates | Governance hardening | Certification gate checklist outcomes | Lane E |

## 3. Non-Negotiable Contract Invariants

1. New cross-project APIs follow Effect-first contracts.
2. TanStack Router is default for new routing/data orchestration work.
3. Hono and React Router/Remix remain compatibility lanes only.
4. Tenant scope is server-bound and never trusted from client assertions.
5. Any MF fallback/degradation must emit structured observability signals.
6. Release promotion requires telemetry + contract gate success.

## 4. Review-Driven Approval Conditions

Architecture board approval for this baseline requires:

1. Explicit enforcement model (policy, CI/review checks, release checks) linked to each major gap.
2. Quantifiable alpha promotion checks for app-level MF SSR.
3. Explicit security ownership for tenant binding, envelope policy, and SSR leak prevention.
4. Ticket mapping for every gap with blocker semantics in Beads.
5. Gate D evidence (>=2 subagent review log per `GATES-0001`) is attached for contract-closing tickets.

## 5. Upstream Compatibility Constraints

To stay close to Modern.js v3:

1. Keep compatibility lanes intact while changing defaults for new development.
2. Prefer additive contracts and feature flags over invasive rewrites.
3. Keep upgrade surface documented in RFC/ADR + public docs.
4. Avoid introducing business-domain assumptions into framework core.

## 6. Exit Criteria For BASELINE-0001

- Matrix validated in architecture review.
- Every gap has an owning Beads stream and dependencies.
- Matrix published in `docs/super-app-rfc-adr` and linked from the folder index.
