# CI-GATES-0001: Gate-to-CI Check and Artifact Mapping

- Status: Active
- Date: 2026-02-22
- Related Beads: `modernjs-44t.1.2.1`
- Depends on: `GATES-0001-ticket-execution-gates.md`

## 1. Purpose

Map ticket gates (A-D) to CI jobs, required artifacts, and blocker semantics so gate completion is verifiable.

## 2. Gate-to-CI Matrix

| Gate | Primary CI Workflows | Evidence Required | Blocker Semantics |
| --- | --- | --- | --- |
| Gate A: Architecture scope review | PR description + ticket docs checks (manual today) | Scope/out-of-scope, ADR links, compatibility impact, risk/rollback note | Ticket cannot move to implementation if architecture evidence missing |
| Gate B: Implementation validation | `type-check.yml`, targeted build workflow (`build-main-website.yml`, `build-builder-website.yml`, `build-module-website.yml`, or relevant lane workflow) | Reproducible validation command list and pass output excerpt | Missing validation evidence blocks ticket close |
| Gate C: Testing proof | `ut-macOS.yml`, `ut-Windows.yml`, `integration-test-Linux.yml`, `integration-test-Windows.yml`, targeted E2E (`test-builder-e2e.yml`) | Test inventory + command list + pass/fail summary + follow-up ticket for known gaps | Any failed required test blocks ticket close |
| Gate D: Final review (>=2 subagents) | Manual evidence gate (automatable in follow-up) | Two reviewer records, finding status, residual-risk resolution | Missing dual-review evidence blocks ticket close and release promotion |

## 3. Required Artifact Contract

Every ticket must attach or link:

1. `architecture-evidence.md` (or ticket section) for Gate A.
2. `validation-evidence.md` (or ticket section) for Gate B with exact commands.
3. `test-evidence.md` (or ticket section) for Gate C with commands/results.
4. `review-evidence.md` (or ticket section) for Gate D with two reviewer records.

Minimum metadata fields:

1. `author`
2. `timestamp`
3. `ticket_id`
4. `commit_sha`
5. `workflow_run_url` (if CI-backed evidence)

## 4. Workflow Coverage Reference

Current workflow set referenced by this mapping:

1. Lint and policy: `.github/workflows/lint-Linux.yml`
2. Type check: `.github/workflows/type-check.yml`
3. Unit tests: `.github/workflows/ut-macOS.yml`, `.github/workflows/ut-Windows.yml`
4. Integration tests: `.github/workflows/integration-test-Linux.yml`, `.github/workflows/integration-test-Windows.yml`
5. E2E: `.github/workflows/test-builder-e2e.yml`
6. RC contract gates: `.github/workflows/release-contract-gates.yml`
7. Boundary anti-pattern checks: `.github/workflows/boundary-anti-patterns.yml`
8. Module certification gates: `.github/workflows/module-certification-gates.yml`
9. Bun super-app smoke: `.github/workflows/bun-superapp-smoke.yml`

## 5. Blocking Enforcement Model

1. PR merge is blocked if required workflow checks for touched scope are failing.
2. Ticket close is blocked if any required gate artifact is missing.
3. Release promotion is blocked if Gate D evidence or required test evidence is absent.
4. Waivers must include approver identity, rationale, and expiry date.
5. Artifact-shape and dual-review completeness are CI-enforced via release gate validators and gate snapshot checks.

## 6. Scope-to-Workflow Selection Rules

1. Docs-only governance ticket:
   - Required: docs build validation (`build-main-website.yml` and/or `build-builder-website.yml` and/or `build-module-website.yml`, based on touched docs scope) + Gate D evidence.
2. Runtime/framework code ticket:
   - Required: type check + relevant unit tests + lane-specific integration tests.
3. MF/SSR ticket:
   - Required: integration tests + E2E where applicable + fallback/reliability evidence.
4. Security/policy ticket:
   - Required: negative-path tests and policy enforcement evidence.

## 7. Follow-up Automation Work

This mapping defines the contract; automation hardening should be implemented incrementally:

1. CI validates evidence presence/shape and reviewer count via `validate-release-candidate-gates.js`.
2. PR workflows for release/module certification gates run as status checks on evidence and gate tooling changes.
3. Gate snapshot artifact shape is validated via `validate-gate-snapshot.js` and required gate-name assertions.

Status update (2026-02-22):

1. Added RC contract gate workflow:
  - `.github/workflows/release-contract-gates.yml`
2. Added validator tooling:
  - `scripts/release-gates/validate-release-candidate-gates.js`
  - `scripts/release-gates/validator.js`
  - `scripts/release-gates/rc-contract-profile.json`
3. Coverage includes:
  - evidence metadata/shape validation
  - migration contract assertions on representative module artifacts
  - representative gate test command execution for release-candidate readiness
4. Added boundary anti-pattern workflow + tooling:
  - `.github/workflows/boundary-anti-patterns.yml`
  - `scripts/boundary-guards/check-boundary-violations.js`
  - `scripts/boundary-guards/validator.js`
  - `scripts/boundary-guards/profile.json`
5. Added module certification gate profile + workflow:
  - `.github/workflows/module-certification-gates.yml`
  - `scripts/release-gates/module-certification-profile.json`
  - `docs/super-app-rfc-adr/evidence/module-certification/current/*.md`
6. Added Bun smoke gate workflow:
  - `.github/workflows/bun-superapp-smoke.yml`
  - `package.json` script `validate:bun-smoke`
7. Added PR status checks for gate evidence automation:
  - `.github/workflows/release-contract-gates.yml` (pull_request trigger + gate snapshot validation)
  - `.github/workflows/module-certification-gates.yml` (pull_request trigger + gate snapshot validation)
8. Added gate snapshot shape validator:
  - `scripts/release-gates/validate-gate-snapshot.js`
  - `scripts/release-gates/validator.js` (`validateGateSnapshotFile`)
  - `package.json` script `validate:gate-snapshot`

## 8. Exit Criteria For CI-GATES-0001

1. Mapping is linked from RFC/ADR index and `GATES-0001`.
2. Required workflows and artifacts are enumerated.
3. Blocker semantics are explicit for ticket closure and release promotion.
