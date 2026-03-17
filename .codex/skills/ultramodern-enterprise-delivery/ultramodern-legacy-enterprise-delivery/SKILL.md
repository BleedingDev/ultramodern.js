---
name: ultramodern-enterprise-delivery
description: Enterprise governance and delivery skill for UltraModern.js. Use when agents handle release gates, module certification, evidence collection, telemetry canary policy, and CI contract workflows for large super-app rollouts.
---

# UltraModern Enterprise Delivery

## Governance Sources of Truth

- `docs/super-app-rfc-adr/RFC-0001-super-app-foundation-plan.md`
- `docs/super-app-rfc-adr/CI-GATES-0001-check-and-artifact-map.md`
- `docs/super-app-rfc-adr/REVIEW-0001-architecture-board-log.md`
- `docs/super-app-rfc-adr/ADR-0004-telemetry-standardization-and-exporters.md`
- `docs/super-app-rfc-adr/ADR-0008-bun-superapp-smoke-gates.md`
- `docs/super-app-rfc-adr/BASELINE-0001-current-vs-target-contracts.md`
- Key rollout wording:
  - `independently deployable modules`
  - `VictoriaMetrics`

## Gate Profiles and Validators

- RC profile:
  - `scripts/release-gates/rc-contract-profile.json`
  - `scripts/release-gates/validate-release-candidate-gates.js`
- Module certification profile:
  - `scripts/release-gates/module-certification-profile.json`
- Boundary and SDK validators:
  - `scripts/boundary-guards/check-boundary-violations.js`
  - `scripts/module-sdk-contracts/validate-module-sdk-contracts.js`
- Module contracts:
  - `docs/super-app-rfc-adr/contracts/module-sdk-contracts.json`
  - `docs/super-app-rfc-adr/contracts/module-manifest.example.json`

## Evidence Requirements

- Module certification evidence:
  - `docs/super-app-rfc-adr/evidence/module-certification/current`
- Release candidate evidence:
  - `docs/super-app-rfc-adr/evidence/release-candidate/current`
- Keep evidence files current for architecture, validation, and tests.

## Telemetry Delivery Guardrails

- Keep canary and rollback contracts explicit:
  - `telemetry.canary.promote`
  - `telemetry.canary.rollback`
  - `server.telemetry.canary`
  - `maxUnhealthyExporters`
- Preserve startup and reliability semantics:
  - `failLoudStartup`
  - startup probes are fail-fast by default
  - enqueue/alert flows are best-effort and non-fatal
- Monitor queue metrics:
  - `telemetry.queue.depth`
  - `telemetry.queue.utilization`
  - `telemetry.queue.dropped`

## CI Workflow Anchors

- `.github/workflows/boundary-anti-patterns.yml`
- `.github/workflows/module-certification-gates.yml`
- `.github/workflows/bun-superapp-smoke.yml`

## Execution Commands (proto-managed)

- `proto run pnpm -- validate:module-sdk-contracts`
- `proto run pnpm -- validate:boundary-guards`
- `proto run pnpm -- validate:module-certification-gates`
- `proto run pnpm -- validate:rc-gates`
- `proto run pnpm -- validate:bun-smoke`
