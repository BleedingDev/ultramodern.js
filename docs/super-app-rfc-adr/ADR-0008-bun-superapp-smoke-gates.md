# ADR-0008: Bun Super-App Smoke Gates

- Status: Implemented
- Date: 2026-02-22
- Related Beads: `modernjs-1e3`
- Depends on:
  - `SDK-0001-module-sdk-contracts.md`
  - `ADR-0006-boundary-anti-pattern-checks.md`
  - `ADR-0007-module-certification-gates.md`

## 1. Context

Deployment preference is Bun, but current governance checks were validated primarily with Node/pnpm execution.

We need deterministic Bun-lane smoke validation to keep Bun first-class without breaking existing Node workflow compatibility.

## 2. Decision

Add Bun smoke gate command and CI workflow:

1. Package script:
   - `pnpm run validate:bun-smoke`
2. CI workflow:
   - `.github/workflows/bun-superapp-smoke.yml`

The Bun smoke gate validates a dependency-free compatibility slice:

1. module certification profile validation (migration/evidence checks) via Bun runtime.
2. shared script helpers used by the release-gate profile can parse profiles, read evidence, and emit gate snapshots under Bun.
3. the full module SDK and boundary policy correctness matrix remains owned by the Node contract-gates workflow.

## 3. Consequences

Positive:

1. Bun gets explicit governance smoke coverage for the release-gate tooling path without duplicating the Node gate matrix.
2. Existing Node workflows remain unchanged.
3. Failures in Bun execution surface early in PR workflows.

Tradeoff:

1. Bun smoke is not a full replacement for existing Node unit/integration suites.
2. Workflow adds one more CI lane to maintain.

## 4. Validation Command

1. `pnpm run validate:bun-smoke`
