---
name: Ultramodern Wave 0 Contract-First Execution
overview: Must-pass contract and governance gate before any Wave 1 implementation for MV-first Ultramodern.
todos:
  - id: uw0-01
    content: Define MF-vs-Garfish parity contract with explicit known non-equivalences.
    status: pending
  - id: uw0-02
    content: Define topology manifest schema (URL indirection, integrity, attestation, TTL, LKG, revocation).
    status: pending
  - id: uw0-03
    content: Define Zephyr vanilla profile contract and constraints.
    status: pending
  - id: uw0-04
    content: Define extraction boundary contract (no cross-vertical imports, explicit auth/session/trace contracts).
    status: pending
  - id: uw0-05
    content: Define DS platform contract (vendor-neutral) and adapter requirements.
    status: pending
  - id: uw0-06
    content: Define template manifest contract and supply-chain policy for external templates.
    status: pending
  - id: uw0-07
    content: Define support matrix and CI economics contract.
    status: pending
  - id: uw0-08
    content: Define ownership schema and graph-aware blast-radius policy.
    status: pending
  - id: uw0-09
    content: Define runtime kill-switch and incident/rollback contract.
    status: pending
  - id: uw0-10
    content: Publish binary Wave 1 entry checklist and validation command.
    status: pending
isProject: true
---

# Ultramodern Wave 0 Contract-First Execution

## Purpose
Wave 0 is contract-first. No broad runtime/product rollout starts before this wave is green.

## Hard Entry Rule
If any Wave 0 item is red, **Wave 1 is blocked**.

## Deliverables (Must Exist)

1. `docs/super-app-rfc-adr/contracts/mv-runtime-parity-contract.json`
2. `docs/super-app-rfc-adr/contracts/mv-topology-manifest.schema.json`
3. `docs/super-app-rfc-adr/contracts/mv-template-manifest.schema.json`
4. `docs/super-app-rfc-adr/contracts/mv-ownership.schema.json`
5. `docs/super-app-rfc-adr/ADR-0010-mv-wave0-contract-first-gates.md`
6. `docs/super-app-rfc-adr/ADR-0011-mf-vs-garfish-runtime-parity-contract.md`
7. `docs/super-app-rfc-adr/ADR-0012-mv-topology-manifest-and-zephyr-profile.md`
8. `docs/super-app-rfc-adr/ADR-0013-mv-ds-platform-contract.md`
9. `docs/super-app-rfc-adr/ADR-0014-mv-template-supply-chain-policy.md`
10. `docs/super-app-rfc-adr/ADR-0015-mv-ownership-and-blast-radius-gates.md`

## Must-Pass Conditions

1. MF-vs-Garfish parity taxonomy is explicit and testable.
2. External remotes/templates are pinned + provenance-checked by policy.
3. Zephyr compatibility profile is explicit and validated as vanilla Modern.js compatible.
4. Extraction contract forbids hidden shell coupling.
5. DS contract is vendor-neutral and supports internal + third-party + horizontal-remote models.
6. Support matrix defines Golden/Compat/Experimental with CI budget.
7. Ownership policy supports multi-owner (human/team/agent/service-account).
8. Runtime kill-switch strategy exists for remote/DS/manifest failures.
9. Stop-loss criteria are documented.
10. Single validation command reports Wave 0 readiness.

## Validation Commands (Target)

- `pnpm run validate:module-sdk-contracts`
- `pnpm run validate:boundary-guards`
- `pnpm run validate:module-certification-gates`
- `pnpm run validate:wave0-mv-contracts` (new)

## Exit Criteria
All 10 conditions pass; Wave 1 may start.
