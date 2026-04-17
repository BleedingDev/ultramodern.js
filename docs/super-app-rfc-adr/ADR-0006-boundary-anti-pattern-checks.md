# ADR-0006: Boundary Anti-Pattern Checks

- Status: Implemented
- Date: 2026-02-22
- Related Beads: `modernjs-44t.6.3`
- Depends on:
  - `BOUNDARY-0001-framework-core-vs-module-vs-external-matrix.md`
  - `SDK-0001-module-sdk-contracts.md`

## 1. Context

We need deterministic CI checks that detect framework-boundary violations:

1. framework core importing module-domain or vendor-connector code.
2. MF runtime paths missing trust/fallback instrumentation.
3. cross-project request plumbing missing operation/trace context propagation.
4. module source code bypassing SDK policy by using forbidden patterns.

## 2. Decision

Implement profile-driven anti-pattern checks:

1. Guard profile:
   - `scripts/boundary-guards/profile.json`
2. Validator + CLI:
   - `scripts/boundary-guards/validator.js`
   - `scripts/boundary-guards/check-boundary-violations.js`
3. CI workflow:
   - `.github/workflows/boundary-anti-patterns.yml`

The checks consume module SDK contract artifacts:

1. `docs/super-app-rfc-adr/contracts/module-sdk-contracts.json`
2. module manifests (example + real manifests in downstream repos)

## 3. Enforcement Model

### 3.1 Import guards

Scan framework-core roots and fail if import specifiers match banned patterns for:

1. module-domain package imports from framework core.
2. vendor connector package imports from framework core.

### 3.2 Required snippet checks

Fail if required hardening snippets disappear from critical paths:

1. MF trust + compatibility checks before app registration.
2. MF fallback telemetry emission hooks.
3. cross-project operation context + trace propagation in browser/node create-request runtimes.
4. cross-project policy enforcement invariants in BFF core.

### 3.3 Forbidden pattern checks by shared contract and optional profile

For each declared module manifest, scan module source directory and fail on forbidden patterns defined by the shared contract plus any optional profile overlay (for example direct `createRequest(...)` bypass).

## 4. Consequences

Positive:

1. boundary drift becomes a fast CI failure instead of post-release discovery.
2. module-contract policy is machine-enforced and reusable by downstream module repos.
3. checks are profile-driven and can evolve without modifying CI logic.

Tradeoff:

1. snippet-based checks require profile maintenance when refactors move code paths.
2. import-pattern checks are conservative and may need pattern tuning for new package structures.

## 5. Validation Commands

1. `node --test scripts/boundary-guards/__tests__/validator.test.js`
2. `pnpm run validate:module-sdk-contracts`
3. `pnpm run validate:boundary-guards`

## 6. Subagent Review Constraint

Attempted subagent reviews for this ticket hit platform limit:

1. `spawn_agent` returned: `agent thread limit reached (max 16)`.
2. constraint is recorded in ticket evidence until threads are available again.
