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

We need deterministic Bun-lane smoke validation to keep Bun first-class without breaking compatibility lanes.

## 2. Decision

Add Bun smoke gate command and CI workflow:

1. Package script:
   - `pnpm run validate:bun-smoke`
2. CI workflow:
   - `.github/workflows/bun-superapp-smoke.yml`

The Bun smoke gate validates:

1. module SDK contract + example manifest via Bun runtime.
2. boundary anti-pattern profile checks via Bun runtime.
3. module certification profile validation (migration/evidence checks) via Bun runtime.

## 3. Consequences

Positive:

1. Bun gets explicit governance smoke coverage for super-app contract tooling.
2. Compatibility lanes remain unchanged (Node workflows still run).
3. Failures in Bun execution surface early in PR workflows.

Tradeoff:

1. Bun smoke is not a full replacement for existing Node unit/integration suites.
2. Workflow adds one more CI lane to maintain.

## 4. Validation Command

1. `pnpm run validate:bun-smoke`
