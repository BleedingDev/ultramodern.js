# ADR-0007: Module Onboarding Certification Gates

- Status: Implemented
- Date: 2026-02-22
- Related Beads: `modernjs-44t.6.4`
- Depends on:
  - `SDK-0001-module-sdk-contracts.md`
  - `ADR-0006-boundary-anti-pattern-checks.md`
  - `CI-GATES-0001-check-and-artifact-map.md`

## 1. Context

We need a repeatable, auditable onboarding gate before a module can be treated as release-ready in the super-app shell.

Existing RC gate tooling (`modernjs-44t.5.5`) validates release contracts, but module onboarding needs a dedicated profile focusing on:

1. module SDK contract compliance.
2. boundary anti-pattern enforcement.
3. evidence completeness with dual-review requirements.

## 2. Decision

Add a dedicated module certification profile and CI workflow:

1. Profile:
   - `scripts/release-gates/module-certification-profile.json`
2. Workflow:
   - `.github/workflows/module-certification-gates.yml`
3. Validation script entrypoint (reused):
   - `scripts/release-gates/validate-release-candidate-gates.js`
4. Repository script:
   - `pnpm run validate:module-certification-gates`

## 3. Gate Contract

### 3.1 Required evidence files

Under `docs/super-app-rfc-adr/evidence/module-certification/current`:

1. `architecture-evidence.md`
2. `validation-evidence.md`
3. `test-evidence.md`
4. `review-evidence.md`

### 3.2 Required metadata fields

1. `author`
2. `timestamp`
3. `ticket_id`
4. `commit_sha`
5. `workflow_run_url`
6. `module_id`
7. `runtime_lane`

### 3.3 Minimum review requirement

`review-evidence.md` must include at least two reviewer entries.

### 3.4 Command matrix

1. `pnpm run validate:module-sdk-contracts`
2. `pnpm run validate:boundary-guards`
3. `node --test scripts/module-sdk-contracts/__tests__/validator.test.js`
4. `node --test scripts/boundary-guards/__tests__/validator.test.js`

## 4. Consequences

Positive:

1. module readiness is standardized and machine-verifiable.
2. SDK contract and boundary checks are required before onboarding.
3. governance artifacts are explicit and reusable across domain-neutral modules and any optional profile overlays.

Tradeoff:

1. evidence maintenance is operational overhead and must stay current.
2. dual-review policy is constrained by subagent platform limits; blockers must be documented when limits are hit.

## 5. Validation Commands

1. `pnpm run validate:module-certification-gates`
2. `node scripts/release-gates/validate-release-candidate-gates.js --profile scripts/release-gates/module-certification-profile.json --evidence-dir docs/super-app-rfc-adr/evidence/module-certification/current`
